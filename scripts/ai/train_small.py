"""Train a tiny candidate-scoring MLP from teacher JSONL. Standard library only.

No rules are reimplemented here. Input features/labels come from the actual TS engine.
This script does nothing until explicitly invoked. Validation groups entire battles.
"""
import argparse
import hashlib
import json
import math
import random
from pathlib import Path

def softmax(values):
    top=max(values)
    result=[math.exp(max(-60,v-top)) for v in values]
    total=sum(result)
    return [v/total for v in result]

def forward(model,features):
    hidden=[[max(0,sum(a*b for a,b in zip(row,x))+bias) for row,bias in zip(model['hidden'],model['hiddenBias'])] for x in features]
    scores=[sum(a*b for a,b in zip(model['output'],h))+model['outputBias'] for h in hidden]
    return hidden,softmax(scores)

def metric(model,rows):
    loss=correct=0
    for row in rows:
        _,probs=forward(model,row['features'])
        loss-=math.log(max(1e-12,probs[row['target']]))
        correct+=max(range(len(probs)),key=lambda i:probs[i])==row['target']
    return {'samples':len(rows),'crossEntropy':loss/len(rows),'top1':correct/len(rows)}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--data',required=True)
    p.add_argument('--out',default='artifacts/ai/small-model.json')
    p.add_argument('--name',default='small-imitation-model')
    p.add_argument('--epochs',type=int,default=25)
    p.add_argument('--hidden',type=int,default=32)
    p.add_argument('--lr',type=float,default=.003)
    p.add_argument('--batch',type=int,default=32)
    p.add_argument('--seed',type=int,default=20261012)
    args=p.parse_args()
    if not 1<=args.hidden<=128 or args.epochs<1 or args.batch<1 or not 0<args.lr<=.1:
        p.error('hidden 为 1..128，epochs/batch 正整数，lr 为 (0,.1]')
    rows=[];names=None
    with Path(args.data).open(encoding='utf-8-sig') as source:
        for line in source:
            if not line.strip():continue
            row=json.loads(line)
            if row.get('format')!='card-master-ai-sample' or row.get('version')!=1:
                raise ValueError('样本格式不匹配')
            names=names or row['featureNames']
            if row['featureNames']!=names or not isinstance(row.get('gameId'),str) or not isinstance(row.get('seed'),int):
                raise ValueError('特征版本或对局标识不匹配')
            x=row['features'];target=row['target']
            if not x or not isinstance(target,int) or not 0<=target<len(x) or any(len(v)!=len(names) or any(not isinstance(t,(int,float)) or not math.isfinite(t) or abs(t)>100 for t in v) for v in x):
                raise ValueError('样本数值、维度或标签无效')
            rows.append(row)
    if not rows:raise ValueError('样本为空')
    # Seed grouping keeps both sides and all actions of the same matchup in one split.
    groups=sorted(set(r['seed'] for r in rows),key=lambda s:hashlib.sha256(f'{args.seed}:{s}'.encode()).digest())
    if len(groups)<3:raise ValueError('至少需要 3 个不同 seed 的完整对局以划分训练/验证/测试集')
    n_test=max(1,len(groups)//10);n_val=max(1,len(groups)//5)
    test_ids=set(groups[:n_test]);validation_ids=set(groups[n_test:n_test+n_val])
    test=[r for r in rows if r['seed'] in test_ids]
    validation=[r for r in rows if r['seed'] in validation_ids]
    train=[r for r in rows if r['seed'] not in test_ids|validation_ids]
    rng=random.Random(args.seed);n=len(names);h=args.hidden
    model={'format':'card-master-ai','version':1,'name':args.name,'featureNames':names,'kind':'mlp',
           'hidden':[[rng.gauss(0,.08) for _ in range(n)] for _ in range(h)],'hiddenBias':[.02]*h,
           'output':[rng.gauss(0,.08) for _ in range(h)],'outputBias':0}
    best=None;best_loss=float('inf');history=[]
    for epoch in range(args.epochs):
        rng.shuffle(train)
        for start in range(0,len(train),args.batch):
            batch=train[start:start+args.batch]
            dw=[[0.0]*n for _ in range(h)];db=[0.0]*h;do=[0.0]*h
            for row in batch:
                activations,probs=forward(model,row['features'])
                for j,(x,active,prob) in enumerate(zip(row['features'],activations,probs)):
                    error=prob-(1 if j==row['target'] else 0)
                    for k in range(h):
                        do[k]+=error*active[k]
                        dz=error*model['output'][k] if active[k]>0 else 0
                        db[k]+=dz
                        for i in range(n):dw[k][i]+=dz*x[i]
            scale=args.lr/len(batch)
            for k in range(h):
                model['output'][k]-=scale*max(-20,min(20,do[k]))
                model['hiddenBias'][k]-=scale*max(-20,min(20,db[k]))
                for i in range(n):model['hidden'][k][i]-=scale*max(-20,min(20,dw[k][i]))
            if any(not math.isfinite(v) or abs(v)>10000 for v in model['output']+model['hiddenBias']+[v for row in model['hidden'] for v in row]):
                raise ValueError('训练出现异常数值，请降低 lr 或检查数据')
        score=metric(model,validation);history.append({'epoch':epoch+1,'validation':score})
        print(f"epoch {epoch+1}/{args.epochs} validation loss={score['crossEntropy']:.4f} top1={score['top1']:.3f}")
        if score['crossEntropy']<best_loss:
            best_loss=score['crossEntropy'];best=json.loads(json.dumps(model))
    out=Path(args.out);out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(best,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    report={'seed':args.seed,'epochs':args.epochs,'hidden':args.hidden,'split':'matchup seed; whole battles',
            'trainSamples':len(train),'validation':metric(best,validation),'test':metric(best,test),'history':history,
            'note':'模仿准确率不等于游戏胜率。请另用 ai:evaluate 在独立 seed/牌组上比较。'}
    Path(str(out)+'.report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

if __name__=='__main__':main()

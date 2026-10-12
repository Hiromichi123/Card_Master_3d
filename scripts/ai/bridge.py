"""JSON-lines bridge for future RL/self-play; the TS engine owns all rules.

Usage from a trainer:
    with BattleEnv() as env:
        observation = env.reset(seed=42)
        observation, reward, done = env.step(0)  # index in current legal candidates
No environment or training starts by importing this module.
"""
import json
import subprocess
from pathlib import Path

class BattleEnv:
    def __init__(self,node='node',opponent='heuristic',suite=None):
        root=Path(__file__).resolve().parents[2]
        command=[node,str(root/'scripts/ai/run.mjs'),'serve','--opponent',opponent]
        if suite:command+=['--suite',str(Path(suite).resolve())]
        self.process=subprocess.Popen(command,cwd=root,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                                      text=True,encoding='utf-8',stderr=None,
                                      creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        self.current=None
    def request(self,message):
        if self.process.poll() is not None:raise RuntimeError('TS 环境已经退出')
        self.process.stdin.write(json.dumps(message)+'\n');self.process.stdin.flush()
        line=self.process.stdout.readline()
        if not line:raise RuntimeError('TS 环境未返回结果，请检查 Node/Vite 或上方错误输出')
        result=json.loads(line)
        if not result.get('ok'):raise RuntimeError(result.get('error','环境调用失败'))
        return result
    def reset(self,seed=42,side='player',split='train'):
        self.current=self.request({'op':'reset','seed':seed,'side':side,'split':split})['observation']
        return self.current
    def step(self,action):
        if not self.current or self.current['done']:raise RuntimeError('请先 reset 到未结束的对局')
        if isinstance(action,bool) or not isinstance(action,int) or not 0<=action<len(self.current['features']):
            raise ValueError('action 必须是当前合法候选的下标')
        result=self.request({'op':'step','action':action});self.current=result['observation']
        return self.current,result['reward'],self.current['done']
    def close(self):
        try:
            if self.process.poll() is None:self.request({'op':'close'})
            self.process.wait(timeout=3)
        except (OSError,RuntimeError,subprocess.TimeoutExpired):
            self.process.terminate()
            try:self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:self.process.kill();self.process.wait()
        finally:
            if self.process.stdin:self.process.stdin.close()
            if self.process.stdout:self.process.stdout.close()
    def __enter__(self):return self
    def __exit__(self,*_):self.close()

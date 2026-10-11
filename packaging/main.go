//go:build windows

// Card Master 3D —— 单文件离线版
//
// 这个程序把 dist/ 整个内嵌进 exe，启动一个只读的本地 HTTP 服务，然后打开浏览器。
// 接收方不需要安装 Node、Python 或任何运行时。
//
// 只支持 Windows：openBrowser 走 cmd 的 start，图标资源是 PE 的 .rsrc。
//
// 为什么必须要一个 HTTP 服务、不能直接双击 dist/index.html 打开：
//  1. dist/index.html 里引用的是根绝对路径（/assets/...、/favicon.svg），
//     file:// 下会变成 file:///assets/... —— 404。
//  2. <script type="module"> 在 file:// 下被 CORS 拦掉（origin 'null'）。
//  3. 卡面纹理走 three.js 的 TextureLoader（内部是 XHR），file:// 下同样被拦。
//
// 打包流程见同目录 build.sh。
package main

import (
	"bytes"
	"embed"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path"
	"strings"
	"syscall"
	"time"
)

//go:embed all:dist
var embedded embed.FS

// contentTypes 写死一张表，**故意不用 mime.TypeByExtension**。
//
// Go 的 mime 包在 Windows 上会先读注册表，而 .js 的映射各家机器不一样；
// 一旦给成浏览器不认的类型，<script type="module"> 会被直接拒绝执行（白屏），
// 而且报错很难懂。写死以后就跟接收方的机器无关了。
var contentTypes = map[string]string{
	".html":  "text/html; charset=utf-8",
	".js":    "text/javascript; charset=utf-8",
	".mjs":   "text/javascript; charset=utf-8",
	".css":   "text/css; charset=utf-8",
	".json":  "application/json; charset=utf-8",
	".map":   "application/json; charset=utf-8",
	".txt":   "text/plain; charset=utf-8",
	".svg":   "image/svg+xml",
	".png":   "image/png",
	".webp":  "image/webp",
	".jpg":   "image/jpeg",
	".jpeg":  "image/jpeg",
	".gif":   "image/gif",
	".ico":   "image/x-icon",
	".woff2": "font/woff2",
	".woff":  "font/woff",
	".ttf":   "font/ttf",
	".mp3":   "audio/mpeg",
	".ogg":   "audio/ogg",
	".wav":   "audio/wav",
	".glb":   "model/gltf-binary",
	".gltf":  "model/gltf+json",
	".wasm":  "application/wasm",
}

// startTime 作为所有文件的 Last-Modified。每次启动取当前时间，
// 这样换一个新构建发给对方时，浏览器不会因为旧的 If-Modified-Since 拿到陈旧副本。
var startTime = time.Now()

func main() {
	port := flag.Int("port", 17873, "监听端口；被占用时自动换一个空闲端口")
	lan := flag.Bool("lan", false, "绑定 0.0.0.0，让同一局域网的其他设备也能访问")
	open := flag.Bool("open", true, "启动后自动打开默认浏览器")
	flag.Parse()

	enableUTF8Console()

	host := "127.0.0.1"
	if *lan {
		host = "0.0.0.0"
	}

	listener, actualPort, err := listen(host, *port)
	if err != nil {
		fatal("无法监听端口：%v", err)
	}

	localURL := fmt.Sprintf("http://127.0.0.1:%d/", actualPort)
	printBanner(localURL, *lan, actualPort)

	if *open {
		go func() {
			time.Sleep(300 * time.Millisecond) // 等 Serve 起来再开浏览器，免得抢跑
			openBrowser(localURL)
		}()
	}

	server := &http.Server{Handler: http.HandlerFunc(handle)}
	if err := server.Serve(listener); err != nil {
		fatal("服务异常退出：%v", err)
	}
}

// enableUTF8Console 把控制台输出代码页切成 UTF-8(65001)。
//
// 中文 Windows 的控制台默认是 936(GBK)，而 Go 往 stdout 写的是 UTF-8 字节，
// 不切的话黑窗口里的中文全变乱码 —— 而这个窗口是接收方唯一的反馈渠道。
//
// 输出被重定向到管道/文件时（比如测试脚本里），这个调用会失败，
// 但没有害处：那种情况下不该动代码页，直接忽略返回值即可。
func enableUTF8Console() {
	const utf8CodePage = 65001
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	if err := kernel32.NewProc("SetConsoleOutputCP").Find(); err != nil {
		return
	}
	_, _, _ = kernel32.NewProc("SetConsoleOutputCP").Call(utf8CodePage)
}

// listen 优先用指定端口，被占用（或端口非法）就退回到内核分配的空闲端口。
func listen(host string, port int) (net.Listener, int, error) {
	if port > 0 && port < 65536 {
		if ln, err := net.Listen("tcp", fmt.Sprintf("%s:%d", host, port)); err == nil {
			return ln, port, nil
		}
	}
	ln, err := net.Listen("tcp", host+":0")
	if err != nil {
		return nil, 0, err
	}
	return ln, ln.Addr().(*net.TCPAddr).Port, nil
}

func handle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "只支持 GET / HEAD", http.StatusMethodNotAllowed)
		return
	}

	// path.Clean("/" + …) 会把 ../ 归一化掉，穿越不出 dist/。
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" {
		name = "index.html"
	}

	data, err := embedded.ReadFile("dist/" + name)
	if err != nil {
		// 这个游戏没有 URL 路由（场景切换是 React state），
		// 所以找不到就是真找不到，不需要 SPA fallback。
		http.NotFound(w, r)
		return
	}

	if ct, ok := contentTypes[strings.ToLower(path.Ext(name))]; ok {
		w.Header().Set("Content-Type", ct)
	}
	w.Header().Set("Cache-Control", cacheControl(name))
	// ServeContent 负责 Range 与 If-Modified-Since，大图和音频可以分段拉。
	http.ServeContent(w, r, path.Base(name), startTime, bytes.NewReader(data))
}

func cacheControl(name string) string {
	base := path.Base(name)
	if base == "index.html" {
		// 入口不能缓存，否则换了新构建还进老页面。
		return "no-cache"
	}
	// Vite 产出的 bundle 文件名里带内容哈希，改内容就换名字，可以放心长缓存。
	if strings.HasPrefix(base, "index-") &&
		(strings.HasSuffix(base, ".js") || strings.HasSuffix(base, ".css")) {
		return "public, max-age=31536000, immutable"
	}
	// 卡面/背景是按固定名字引用的，可能被替换，只给短缓存。
	return "public, max-age=3600"
}

// openBrowser 只针对 Windows。start 是 cmd 内建命令，
// 第一个空参数是它的「窗口标题」占位 —— 少了它，带引号的 URL 会被当成标题吞掉。
func openBrowser(url string) {
	_ = exec.Command("cmd", "/c", "start", "", url).Start()
}

// lanIP 只为在提示里打印局域网地址。UDP「连接」不会真的发包，
// 只是让内核按路由表挑一张网卡，从而拿到本机局域网 IP。
func lanIP() string {
	conn, err := net.Dial("udp", "10.255.255.255:1")
	if err != nil {
		return ""
	}
	defer conn.Close()
	if addr, ok := conn.LocalAddr().(*net.UDPAddr); ok {
		return addr.IP.String()
	}
	return ""
}

func printBanner(localURL string, lan bool, port int) {
	fmt.Println()
	fmt.Println("==================================================")
	fmt.Println("  Card Master 3D —— 离线版已启动")
	fmt.Println("==================================================")
	fmt.Println()
	fmt.Printf("  本机访问： %s\n", localURL)
	if lan {
		if ip := lanIP(); ip != "" {
			fmt.Printf("  局域网内： http://%s:%d/\n", ip, port)
		}
	}
	fmt.Println()
	fmt.Println("  浏览器没自动打开？把上面那行地址复制到浏览器地址栏就行。")
	fmt.Println("  玩完直接关掉这个黑窗口，不会在系统里残留任何东西。")
	fmt.Println()
	fmt.Println("  存档存在你浏览器自己的 IndexedDB 里（不在这个程序里）。")
	fmt.Println("  换了端口就等于换了网站，存档会「看起来丢了」——")
	fmt.Println("  所以别同时开两个副本，端口被占时它会自动换一个。")
	fmt.Println()
}

// fatal 打印错误后**等一下回车**再退出。
// 双击启动时窗口会瞬间关闭，不等的话用户什么都看不到。
func fatal(format string, args ...any) {
	fmt.Println()
	fmt.Printf("[错误] "+format+"\n", args...)
	fmt.Println()
	fmt.Println("按回车键关闭这个窗口...")
	_, _ = fmt.Scanln()
	os.Exit(1)
}

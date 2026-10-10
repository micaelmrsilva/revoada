// Abre uma página num WKWebView sem janela, roda um trecho de JavaScript e imprime o que ele devolve.
// É o mesmo motor do app (a janela nativa é um WKWebView), então o teste de tela usa isto no macOS
// pra conferir o que no Chrome pode se comportar diferente.
// Uso: swift tests/webkit.swift <endereço> <javascript> [largura]
import AppKit
import WebKit

let args = CommandLine.arguments
let url = URL(string: args[1])!, js = args[2]
let width = args.count > 3 ? Double(args[3]) ?? 1280 : 1280

class Runner: NSObject, WKNavigationDelegate {
  let view = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: 860))
  let window: NSWindow
  override init() {
    window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
    super.init()
    window.contentView = view
    view.navigationDelegate = self
    view.load(URLRequest(url: url))
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    view.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { result in
      switch result {
      case .success(let value): print(value); exit(0)
      case .failure(let error): FileHandle.standardError.write("\(error)\n".data(using: .utf8)!); exit(1)
      }
    }
  }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    FileHandle.standardError.write("não abriu a página: \(error.localizedDescription)\n".data(using: .utf8)!); exit(1)
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let runner = Runner()
DispatchQueue.main.asyncAfter(deadline: .now() + 45) { FileHandle.standardError.write("tempo esgotado\n".data(using: .utf8)!); exit(1) }
app.run()

// Revoada.app: uma janela nativa em volta do painel. Sobe o servidor embutido,
// espera ele responder e mostra a página; ao sair, encerra o que subiu.
import AppKit
import WebKit
import ServiceManagement
import Carbon.HIToolbox

// atalho global (⌃⌥Espaço) pro pedido rápido; o Carbon ainda é o jeito sem pedir permissão de acessibilidade
var onHotKey: (() -> Void)?
func registerHotKey() {
  var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
  InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in onHotKey?(); return noErr }, 1, &spec, nil, nil)
  var ref: EventHotKeyRef?
  RegisterEventHotKey(UInt32(kVK_Space), UInt32(controlKey | optionKey), EventHotKeyID(signature: OSType(0x52564F41), id: 1), GetApplicationEventTarget(), 0, &ref)
}

let port = Int(ProcessInfo.processInfo.environment["REVOADA_PORT"] ?? "") ?? 4777
let origin = "http://127.0.0.1:\(port)"
let titlebarHeight: CGFloat = 28

// faixa invisível sobre a página: é por ela que se arrasta a janela
final class DragStrip: NSView {
  override var mouseDownCanMoveWindow: Bool { true }
  override func mouseUp(with event: NSEvent) { if event.clickCount == 2 { window?.zoom(nil) } }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler, NSMenuItemValidation {
  var window: NSWindow!
  var web: WKWebView!
  var server: Process?
  var loaded = false
  var status: StatusController!

  var dark: Bool { NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua }
  var logURL: URL { FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".revoada/app.log") }

  func applicationDidFinishLaunching(_ note: Notification) {
    buildMenu()
    let config = WKWebViewConfiguration()
    config.userContentController.addUserScript(WKUserScript(source: "document.documentElement.classList.add('desktop')", injectionTime: .atDocumentStart, forMainFrameOnly: true))
    // erros da página caem no mesmo registro do servidor
    config.userContentController.addUserScript(WKUserScript(source: "addEventListener('error', e => webkit.messageHandlers.log.postMessage('erro na página: ' + e.message + ' (' + (e.filename || '').split('/').pop() + ':' + e.lineno + ')'))", injectionTime: .atDocumentStart, forMainFrameOnly: true))
    config.userContentController.add(self, name: "log")
    config.preferences.setValue(true, forKey: "developerExtrasEnabled")
    web = WKWebView(frame: .zero, configuration: config)
    web.uiDelegate = self
    web.navigationDelegate = self
    web.setValue(false, forKey: "drawsBackground")
    web.autoresizingMask = [.width, .height]

    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1320, height: 860), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
    window.title = "Revoada"
    window.titleVisibility = .hidden
    window.titlebarAppearsTransparent = true
    window.minSize = NSSize(width: 920, height: 600)
    window.isReleasedWhenClosed = false
    window.backgroundColor = dark ? NSColor(red: 0.043, green: 0.063, blue: 0.059, alpha: 1) : .white
    window.center()
    window.setFrameAutosaveName("RevoadaMain")

    let content = window.contentView!
    web.frame = content.bounds
    content.addSubview(web)
    let strip = DragStrip(frame: NSRect(x: 0, y: content.bounds.height - titlebarHeight, width: content.bounds.width, height: titlebarHeight))
    strip.autoresizingMask = [.width, .minYMargin]
    content.addSubview(strip)

    status = StatusController(app: self)
    splash("Abrindo a revoada")
    // aberto pelo sistema no login: fica só na barra de menus, sem janela na cara
    let atLogin = NSAppleEventManager.shared().currentAppleEvent?.paramDescriptor(forKeyword: keyAEPropData)?.enumCodeValue == keyAELaunchedAsLogInItem
    if !atLogin { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    onHotKey = { [weak self] in self?.status.hotKey() }
    registerHotKey()
    boot()
  }

  // ---------- servidor ----------
  func ping(_ done: @escaping (Bool) -> Void) {
    var req = URLRequest(url: URL(string: "\(origin)/api/dirs")!)
    req.timeoutInterval = 0.6
    URLSession.shared.dataTask(with: req) { _, resp, _ in
      let ok = (resp as? HTTPURLResponse)?.statusCode == 200
      DispatchQueue.main.async { done(ok) }
    }.resume()
  }

  func boot() {
    // já tem um painel rodando nesta porta (ex.: `bun start`): só mostra ele
    ping { up in
      if up { return self.show() }
      self.spawn(viaShell: true)
      self.waitReady(deadline: Date().addingTimeInterval(8)) { ok in
        if ok { return self.show() }
        // o shell do usuário pode travar ou demorar; tenta direto, sem ele
        self.server?.terminate()
        self.spawn(viaShell: false)
        self.waitReady(deadline: Date().addingTimeInterval(10)) { ok in
          ok ? self.show() : self.splash("O servidor não respondeu. O registro está em ~/.revoada/app.log")
        }
      }
    }
  }

  func spawn(viaShell: Bool) {
    let res = Bundle.main.resourceURL!
    let bin = res.appendingPathComponent("revoada-server").path
    var env = ProcessInfo.processInfo.environment
    env["REVOADA_ASSETS"] = res.appendingPathComponent("assets").path
    env["REVOADA_SERVER"] = bin
    env["PORT"] = String(port)
    let p = Process()
    if viaShell {
      // pelo shell de login pra herdar o PATH e as variáveis do terminal do usuário
      p.executableURL = URL(fileURLWithPath: "/bin/zsh")
      p.arguments = ["-ilc", "exec \"$REVOADA_SERVER\""]
    } else {
      p.executableURL = URL(fileURLWithPath: bin)
    }
    p.environment = env
    p.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser
    try? FileManager.default.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    FileManager.default.createFile(atPath: logURL.path, contents: nil)
    if let log = try? FileHandle(forWritingTo: logURL) { p.standardOutput = log; p.standardError = log }
    p.standardInput = FileHandle.nullDevice
    do { try p.run(); server = p } catch { splash("Não consegui iniciar o servidor: \(error.localizedDescription)") }
  }

  func waitReady(deadline: Date, _ done: @escaping (Bool) -> Void) {
    ping { up in
      if up { return done(true) }
      if Date() > deadline { return done(false) }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { self.waitReady(deadline: deadline, done) }
    }
  }

  func show() { loaded = true; web.load(URLRequest(url: URL(string: origin)!)); status.start() }

  // traz a janela pra frente e, se pedido, navega até uma tela ou conversa
  func reveal(_ js: String? = nil) {
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    if loaded, let js { web.evaluateJavaScript(js) }
  }

  func splash(_ text: String) {
    let fg = dark ? "#93a19e" : "#5d6d6a", bg = dark ? "#0b100f" : "#ffffff", ink = dark ? "#e4e9e8" : "#18211f"
    var logo = ""
    if let url = Bundle.main.resourceURL?.appendingPathComponent("assets/public/logo.svg"), let svg = try? String(contentsOf: url, encoding: .utf8) { logo = svg }
    web.loadHTMLString("""
      <html><body style="margin:0;height:100vh;display:grid;place-items:center;background:\(bg);color:\(ink);font:14px -apple-system,sans-serif;-webkit-user-select:none">
      <div style="text-align:center"><div style="width:96px;margin:0 auto 18px">\(logo)</div><div style="color:\(fg)">\(text)</div></div></body></html>
      """, baseURL: nil)
  }

  // ---------- ciclo de vida ----------
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    if !flag { window.makeKeyAndOrderFront(nil) }
    return true
  }
  // fechar a janela não mata os agentes; sair do app sim
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    guard server?.isRunning == true, let live = liveWork(), live > 0 else { return .terminateNow }
    let alert = NSAlert()
    alert.messageText = live == 1 ? "Uma conversa ainda está rodando" : "\(live) conversas ainda estão rodando"
    alert.informativeText = "Sair encerra os agentes na hora. As conversas ficam no histórico."
    alert.addButton(withTitle: "Sair")
    alert.addButton(withTitle: "Continuar aberto")
    return alert.runModal() == .alertFirstButtonReturn ? .terminateNow : .terminateCancel
  }

  func liveWork() -> Int? {
    var count: Int?
    let sem = DispatchSemaphore(value: 0)
    var req = URLRequest(url: URL(string: "\(origin)/api/state")!)
    req.timeoutInterval = 1.5
    URLSession.shared.dataTask(with: req) { data, _, _ in
      if let data, let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        let s = (j["sessions"] as? [[String: Any]] ?? []).filter { $0["alive"] as? Bool == true }.count
        let r = (j["runs"] as? [[String: Any]] ?? []).filter { $0["running"] as? Bool == true }.count
        count = s + r
      }
      sem.signal()
    }.resume()
    _ = sem.wait(timeout: .now() + 2)
    return count
  }

  func applicationWillTerminate(_ note: Notification) {
    status?.vigil.shutdown()
    guard let p = server, p.isRunning else { return }
    p.terminate()
    // dá tempo do servidor gravar as conversas abertas no histórico
    let until = Date().addingTimeInterval(2)
    while p.isRunning && Date() < until { usleep(50_000) }
  }

  // ---------- abrir no login ----------
  @objc func toggleLogin(_ sender: Any?) {
    do {
      if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() }
      log("abrir no login: \(SMAppService.mainApp.status == .enabled ? "ligado" : "desligado")")
    } catch {
      log("abrir no login falhou: \(error.localizedDescription)")
      let alert = NSAlert(); alert.messageText = "Não consegui mudar a abertura no login"; alert.informativeText = error.localizedDescription; alert.runModal()
    }
  }
  func validateMenuItem(_ item: NSMenuItem) -> Bool {
    if item.action == #selector(toggleLogin(_:)) { item.state = SMAppService.mainApp.status == .enabled ? .on : .off }
    return true
  }

  // ---------- registro ----------
  func log(_ line: String) {
    guard let h = try? FileHandle(forWritingTo: logURL) else { return }
    h.seekToEndOfFile()
    h.write("[janela] \(line)\n".data(using: .utf8)!)
    try? h.close()
  }
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) { log("\(message.body)") }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard loaded else { return }
    // confere que a página montou de fato dentro da janela
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
      webView.evaluateJavaScript("[document.title, document.documentElement.className, document.querySelectorAll('.nav .item').length + ' itens no menu', S.accounts.length + ' contas', 'tema ' + document.documentElement.dataset.theme, 'logo ' + (document.querySelector('[data-logo] svg') ? 'ok' : 'faltando'), 'vista ' + view.type].join(' | ')") { result, error in
        self.log(error.map { "página não respondeu: \($0.localizedDescription)" } ?? "página carregada: \(result ?? "")")
      }
    }
  }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    log("falha ao carregar: \(error.localizedDescription)")
    if loaded { splash("A página não carregou. O registro está em ~/.revoada/app.log") }
  }

  // ---------- página ----------
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = action.request.url else { return decisionHandler(.cancel) }
    if url.absoluteString.hasPrefix(origin) || url.scheme == "about" { return decisionHandler(.allow) }
    // qualquer link pra fora abre no navegador do sistema
    if url.scheme == "http" || url.scheme == "https" { NSWorkspace.shared.open(url) }
    decisionHandler(.cancel)
  }

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url { NSWorkspace.shared.open(url) }
    return nil
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let alert = NSAlert()
    alert.messageText = message
    alert.addButton(withTitle: "Confirmar")
    alert.addButton(withTitle: "Cancelar")
    alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
  }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let alert = NSAlert()
    alert.messageText = message
    alert.beginSheetModal(for: window) { _ in completionHandler() }
  }

  // ---------- menu ----------
  @objc func goTo(_ sender: NSMenuItem) {
    window.makeKeyAndOrderFront(nil)
    if loaded, let view = sender.representedObject as? String { web.evaluateJavaScript("go({type:'\(view)'})") }
  }
  @objc func reload(_ sender: Any?) { if loaded { web.reload() } }

  func buildMenu() {
    let main = NSMenu()
    func menu(_ title: String, _ build: (NSMenu) -> Void) { let item = NSMenuItem(); let m = NSMenu(title: title); build(m); item.submenu = m; main.addItem(item) }
    func nav(_ m: NSMenu, _ title: String, _ key: String, _ view: String) { let i = m.addItem(withTitle: title, action: #selector(goTo(_:)), keyEquivalent: key); i.target = self; i.representedObject = view }
    menu("Revoada") { m in
      m.addItem(withTitle: "Sobre a Revoada", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
      m.addItem(.separator())
      let login = m.addItem(withTitle: "Abrir ao iniciar o Mac", action: #selector(toggleLogin(_:)), keyEquivalent: ""); login.target = self
      m.addItem(.separator())
      m.addItem(withTitle: "Ocultar Revoada", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
      m.addItem(.separator())
      m.addItem(withTitle: "Sair da Revoada", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    }
    menu("Arquivo") { m in
      nav(m, "Novo chat", "n", "home")
      m.addItem(.separator())
      m.addItem(withTitle: "Fechar janela", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    }
    menu("Editar") { m in
      m.addItem(withTitle: "Desfazer", action: Selector(("undo:")), keyEquivalent: "z")
      m.addItem(withTitle: "Refazer", action: Selector(("redo:")), keyEquivalent: "Z")
      m.addItem(.separator())
      m.addItem(withTitle: "Recortar", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
      m.addItem(withTitle: "Copiar", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
      m.addItem(withTitle: "Colar", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
      m.addItem(withTitle: "Selecionar tudo", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    }
    menu("Ir") { m in
      nav(m, "Cérebro", "1", "brain")
      nav(m, "Contas", "2", "accounts")
      nav(m, "Primeiros passos", "3", "start")
      m.addItem(.separator())
      let r = m.addItem(withTitle: "Recarregar", action: #selector(reload(_:)), keyEquivalent: "r"); r.target = self
    }
    menu("Janela") { m in
      m.addItem(withTitle: "Minimizar", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
      m.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
      m.addItem(withTitle: "Tela cheia", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f").keyEquivalentModifierMask = [.command, .control]
      NSApp.windowsMenu = m
    }
    NSApp.mainMenu = main
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()

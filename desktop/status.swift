// Presença na barra de menus: ícone que bate asa enquanto há agente trabalhando e um
// painel de vidro (public/mini.html) com o que está rodando, contas, limites e pedido rápido.
// Também manda os avisos do sistema e põe o selo no Dock.
import AppKit
import UserNotifications
import WebKit

private let panelWidth: CGFloat = 372

// painel sem borda que aceita foco, pra dar pra digitar o pedido rápido
final class GlassPanel: NSPanel { override var canBecomeKey: Bool { true } }

// as três aves da logo, com as asas numa fase do batimento (0 = paradas)
private func birdsImage(phase: Double) -> NSImage {
  let size = NSSize(width: 21, height: 14)
  let img = NSImage(size: size, flipped: false) { _ in
    let k = size.width / 720
    // (centro x, centro y, meia envergadura, altura da asa, inclinação, opacidade) no desenho original
    let birds: [(Double, Double, Double, Double, Double, Double)] = [(352, 372, 112, 80, -4, 0.5), (668, 430, 175, 125, -10, 1), (452, 650, 290, 200, -6, 1)]
    for (i, b) in birds.enumerated() {
      let beat = phase == 0 ? 0 : sin(phase * 2 * .pi + Double(i) * 2.1)
      let h = b.3 * (1 + 0.42 * beat), cy = b.1 - 14 * beat
      let pts: [(Double, Double)] = [(-b.2, 0.05 * h), (-0.52 * b.2, -1.05 * h), (0, -0.12 * h), (0.52 * b.2, -1.05 * h), (b.2, 0.05 * h), (0.5 * b.2, -0.5 * h), (0, 0.42 * h), (-0.5 * b.2, -0.5 * h)]
      let c = cos(b.4 * .pi / 180), s = sin(b.4 * .pi / 180)
      let P = pts.map { NSPoint(x: (b.0 + $0.0 * c - $0.1 * s - 150) * k, y: size.height - (cy + $0.0 * s + $0.1 * c - 250) * k) }
      let path = NSBezierPath()
      path.move(to: P[0])
      // cada asa é uma curva quadrática; o AppKit só desenha cúbica
      for j in stride(from: 1, to: 8, by: 2) {
        let from = P[j - 1], q = P[j], to = P[(j + 1) % 8]
        path.curve(to: to, controlPoint1: NSPoint(x: from.x + 2 / 3 * (q.x - from.x), y: from.y + 2 / 3 * (q.y - from.y)), controlPoint2: NSPoint(x: to.x + 2 / 3 * (q.x - to.x), y: to.y + 2 / 3 * (q.y - to.y)))
      }
      path.close()
      NSColor.black.withAlphaComponent(b.5).setFill()
      path.fill()
    }
    return true
  }
  img.isTemplate = true
  return img
}

private let quietBeforeNotify: TimeInterval = 8 // sessão que trabalhou menos que isso não avisa quando para

final class StatusController: NSObject, UNUserNotificationCenterDelegate, WKScriptMessageHandler {
  unowned let app: AppDelegate
  let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
  var timer: Timer?
  var state: [String: Any] = [:]
  // memória do último estado, pra avisar só na mudança
  var first = true
  var busySince: [String: Date] = [:]
  var runningRuns: Set<String> = []
  var workingChats: Set<String> = []
  var waitingChats: Set<String> = []
  var limited: Set<String> = []
  var knownSessions: Set<String> = []
  var lastLine = ""
  var panel: GlassPanel!
  var mini: WKWebView!
  var monitors: [Any] = []
  var flap: Timer?
  var phase = 0.0

  init(app: AppDelegate) {
    self.app = app
    super.init()
    item.button?.image = birdsImage(phase: 0)
    item.button?.imagePosition = .imageLeading
    item.button?.target = self
    item.button?.action = #selector(clicked)
    item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
    buildPanel()
    let center = UNUserNotificationCenter.current()
    center.delegate = self
    center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
  }

  // ---------- painel de vidro ----------
  func buildPanel() {
    panel = GlassPanel(contentRect: NSRect(x: 0, y: 0, width: panelWidth, height: 380), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.level = .popUpMenu
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
    panel.isMovable = false
    // painel some por padrão quando o app perde o foco; este vive justamente com o app em segundo plano
    panel.hidesOnDeactivate = false
    let glass = NSVisualEffectView()
    glass.material = .popover
    glass.blendingMode = .behindWindow
    glass.state = .active
    // cantos arredondados pela máscara, pra sombra acompanhar o contorno
    let r: CGFloat = 16
    let mask = NSImage(size: NSSize(width: r * 2 + 1, height: r * 2 + 1), flipped: false) { rect in NSColor.black.setFill(); NSBezierPath(roundedRect: rect, xRadius: r, yRadius: r).fill(); return true }
    mask.capInsets = NSEdgeInsets(top: r, left: r, bottom: r, right: r)
    mask.resizingMode = .stretch
    glass.maskImage = mask
    panel.contentView = glass

    let config = WKWebViewConfiguration()
    config.userContentController.add(self, name: "revoada")
    mini = WKWebView(frame: glass.bounds, configuration: config)
    mini.setValue(false, forKey: "drawsBackground")
    mini.autoresizingMask = [.width, .height]
    glass.addSubview(mini)
  }

  // ⌃⌥Espaço de qualquer lugar: abre o painel já com o cursor no pedido
  func hotKey() { panel.isVisible ? hidePanel() : showPanel() }

  @objc func clicked() {
    if NSApp.currentEvent?.type == .rightMouseUp { return quickMenu() }
    panel.isVisible ? hidePanel() : showPanel()
  }

  func showPanel() {
    guard app.loaded, let button = item.button, let anchor = button.window else { return app.reveal() }
    place(anchor)
    mini.evaluateJavaScript("refresh(); document.getElementById('q').focus()")
    panel.makeKeyAndOrderFront(nil)
    panel.makeFirstResponder(mini)
    button.highlight(true)
    // clique fora fecha, dentro do app ou em qualquer outro lugar
    monitors.append(NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in self?.hidePanel() } as Any)
    monitors.append(NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] e in
      if let self, e.window !== self.panel, e.window !== anchor { self.hidePanel() }
      return e
    } as Any)
  }

  func hidePanel() {
    for m in monitors { NSEvent.removeMonitor(m) }
    monitors = []
    panel.orderOut(nil)
    item.button?.highlight(false)
  }

  // logo abaixo do ícone, sem sair da tela
  func place(_ anchor: NSWindow, height: CGFloat? = nil) {
    let h = height ?? panel.frame.height
    let screen = anchor.screen?.visibleFrame ?? NSScreen.main!.visibleFrame
    var x = anchor.frame.midX - panelWidth / 2
    x = max(screen.minX + 8, min(x, screen.maxX - panelWidth - 8))
    panel.setFrame(NSRect(x: x, y: anchor.frame.minY - h - 6, width: panelWidth, height: h), display: true)
  }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any] else { return }
    if let h = body["height"] as? Double, let anchor = item.button?.window {
      let maxH = (anchor.screen?.visibleFrame.height ?? 800) - 40
      place(anchor, height: min(CGFloat(h), maxH))
    }
    if let ready = body["ready"] as? String {
      app.log("painel da barra pronto: \(ready)")
      // REVOADA_SELFTEST=1: abre e fecha o painel sozinho e registra onde ele apareceu
      if ProcessInfo.processInfo.environment["REVOADA_SELFTEST"] != nil {
        showPanel()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
          let f = self.panel.frame, b = self.item.button?.window?.frame ?? .zero
          self.app.log("autoteste do painel: visível=\(self.panel.isVisible) foco=\(self.panel.isKeyWindow) em x=\(Int(f.minX)) y=\(Int(f.minY)) \(Int(f.width))x\(Int(f.height)); ícone em x=\(Int(b.minX)) y=\(Int(b.minY)) largura=\(Int(b.width))")
          self.hidePanel()
        }
      }
    }
    if body["close"] != nil { hidePanel() }
    if let js = body["open"] as? String { hidePanel(); app.reveal(js.isEmpty ? nil : js) }
  }

  // botão direito: o mínimo, pra quando o painel não é o que se quer
  func quickMenu() {
    let menu = NSMenu()
    let n = menu.addItem(withTitle: "Novo chat", action: #selector(run(_:)), keyEquivalent: ""); n.target = self; n.representedObject = "go({type:'home'})"
    let o = menu.addItem(withTitle: "Abrir a Revoada", action: #selector(run(_:)), keyEquivalent: ""); o.target = self
    let l = menu.addItem(withTitle: "Abrir ao iniciar o Mac", action: #selector(AppDelegate.toggleLogin(_:)), keyEquivalent: ""); l.target = app
    menu.addItem(.separator())
    menu.addItem(withTitle: "Sair", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
    item.menu = menu
    item.button?.performClick(nil)
    item.menu = nil
  }
  @objc func run(_ sender: NSMenuItem) { app.reveal(sender.representedObject as? String) }

  // as aves batem asa só enquanto tem alguém trabalhando
  func animate(_ on: Bool) {
    if on, flap == nil {
      let t = Timer(timeInterval: 1.0 / 14, repeats: true) { [weak self] _ in
        guard let self else { return }
        self.phase += 0.075
        self.item.button?.image = birdsImage(phase: self.phase)
      }
      RunLoop.main.add(t, forMode: .common)
      flap = t
    } else if !on, flap != nil {
      flap?.invalidate(); flap = nil; phase = 0
      item.button?.image = birdsImage(phase: 0)
    }
  }

  func start() {
    mini.load(URLRequest(url: URL(string: "\(origin)/mini")!))
    guard timer == nil else { return }
    let t = Timer(timeInterval: 2.5, repeats: true) { [weak self] _ in self?.poll() }
    // modo .common: continua atualizando com o menu aberto
    RunLoop.main.add(t, forMode: .common)
    timer = t
    poll()
  }

  func poll() {
    var req = URLRequest(url: URL(string: "\(origin)/api/state")!)
    req.timeoutInterval = 2
    URLSession.shared.dataTask(with: req) { data, _, _ in
      guard let data, let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
      DispatchQueue.main.async { self.apply(j) }
    }.resume()
  }

  // ---------- leitura do estado ----------
  var sessions: [[String: Any]] { (state["sessions"] as? [[String: Any]] ?? []).filter { $0["alive"] as? Bool == true } }
  var runs: [[String: Any]] { (state["runs"] as? [[String: Any]] ?? []).filter { $0["running"] as? Bool == true } }
  var chats: [[String: Any]] { (state["convos"] as? [[String: Any]] ?? []).filter { $0["working"] as? Bool == true } }
  var accounts: [[String: Any]] {
    let installed = Set((state["providers"] as? [[String: Any]] ?? []).filter { $0["installed"] as? Bool == true }.compactMap { $0["id"] as? String })
    return (state["accounts"] as? [[String: Any]] ?? []).filter { installed.contains($0["provider"] as? String ?? "") }
  }
  func ok(_ a: [String: Any]) -> Bool { (a["status"] as? [String: Any])?["ok"] as? Bool == true }
  func limit(_ a: [String: Any]) -> [String: Any]? { a["limit"] as? [String: Any] }
  func accountName(_ id: String?) -> String {
    guard let a = (state["accounts"] as? [[String: Any]] ?? []).first(where: { $0["id"] as? String == id }) else { return "conta removida" }
    let prov = (state["providers"] as? [[String: Any]] ?? []).first { $0["id"] as? String == a["provider"] as? String }?["name"] as? String ?? ""
    return "\(prov) · \(a["label"] as? String ?? "")"
  }
  func hm(_ ms: Any?) -> String {
    guard let ms = ms as? Double else { return "" }
    let f = DateFormatter(); f.dateFormat = "HH:mm"
    return f.string(from: Date(timeIntervalSince1970: ms / 1000))
  }
  func clip(_ s: String, _ n: Int = 46) -> String { s.count > n ? String(s.prefix(n - 1)) + "…" : s }

  // ---------- barra, Dock e avisos ----------
  func apply(_ j: [String: Any]) {
    state = j
    let busy = sessions.filter { $0["busy"] as? Bool == true }
    let working = busy.count + runs.count + chats.count
    let lim = accounts.filter { limit($0) != nil }

    let title = NSMutableAttributedString(string: working > 0 ? " \(working)" : "", attributes: [.font: NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .medium)])
    if !lim.isEmpty { title.append(NSAttributedString(string: " ●", attributes: [.foregroundColor: NSColor.systemRed, .font: NSFont.systemFont(ofSize: 9), .baselineOffset: 1])) }
    item.button?.attributedTitle = title
    item.button?.toolTip = summary()
    NSApp.dockTile.badgeLabel = working > 0 ? "\(working)" : nil
    animate(working > 0)
    let line = summary() + (lim.isEmpty ? "" : " · \(lim.count) no limite")
    if line != lastLine { lastLine = line; app.log("barra: \(line)") }

    // sessão: avisa quando para depois de ter trabalhado de verdade
    let busyIds = Set(busy.compactMap { $0["id"] as? String })
    for (id, since) in busySince where !busyIds.contains(id) {
      busySince[id] = nil
      guard let s = sessions.first(where: { $0["id"] as? String == id }), Date().timeIntervalSince(since) >= quietBeforeNotify else { continue }
      notify("\(accountName(s["accountId"] as? String)) parou", s["limitHit"] as? Bool == true ? "Bateu no limite." : "Terminou ou está esperando você: \(s["title"] as? String ?? "")", "go({type:'session',id:'\(id)'})")
    }
    for id in busyIds where busySince[id] == nil { busySince[id] = Date() }

    // conversa: o agente terminou de responder
    let nowChats = Set(chats.compactMap { $0["id"] as? String })
    for id in workingChats.subtracting(nowChats) {
      if let c = (state["convos"] as? [[String: Any]] ?? []).first(where: { $0["id"] as? String == id }) {
        notify("\(accountName(c["accountId"] as? String)) respondeu", c["title"] as? String ?? "", "refresh().then(() => go({type:'chat',id:'\(id)'}))")
      }
    }
    workingChats = nowChats
    // agente parado esperando o usuário permitir ou negar
    let waiting = Set(chats.filter { $0["waiting"] as? Bool == true }.compactMap { $0["id"] as? String })
    for id in waiting.subtracting(waitingChats) {
      if let c = chats.first(where: { $0["id"] as? String == id }) {
        notify("\(accountName(c["accountId"] as? String)) pede permissão", c["title"] as? String ?? "", "refresh().then(() => go({type:'chat',id:'\(id)'}))")
      }
    }
    waitingChats = waiting

    // disparo paralelo terminou
    let nowRunning = Set(runs.compactMap { $0["id"] as? String })
    for id in runningRuns.subtracting(nowRunning) {
      if let r = (state["runs"] as? [[String: Any]] ?? []).first(where: { $0["id"] as? String == id }) {
        notify("Respostas prontas", "\(r["jobs"] as? Int ?? 0) contas responderam: \(r["title"] as? String ?? "")", "go({type:'run',id:'\(id)'})")
      }
    }
    runningRuns = nowRunning

    // conta bateu no limite, e pra onde o rodízio foi
    let nowLimited = Set(lim.compactMap { $0["id"] as? String })
    for id in nowLimited.subtracting(limited) where !first {
      let a = lim.first { $0["id"] as? String == id }!
      let moved = sessions.first { s in !knownSessions.contains(s["id"] as? String ?? "") && s["rotatedFrom"] != nil && !(s["rotatedFrom"] is NSNull) }
      let next = moved.map { " Continuando em \(accountName($0["accountId"] as? String))." } ?? ""
      notify("\(accountName(id)) bateu no limite", "Volta às \(hm(limit(a)?["until"])).\(next)", moved.map { "go({type:'session',id:'\($0["id"] as? String ?? "")'})" } ?? "go({type:'accounts'})")
    }
    limited = nowLimited
    knownSessions = Set(sessions.compactMap { $0["id"] as? String })
    first = false
  }

  func summary() -> String {
    let busy = sessions.filter { $0["busy"] as? Bool == true }.count + runs.count + chats.count
    let idle = sessions.count - sessions.filter { $0["busy"] as? Bool == true }.count
    let ready = accounts.filter { ok($0) && limit($0) == nil }.count
    var parts = [busy == 0 ? "Nada trabalhando" : busy == 1 ? "1 trabalhando" : "\(busy) trabalhando"]
    if idle > 0 { parts.append(idle == 1 ? "1 aberta" : "\(idle) abertas") }
    parts.append("\(ready) de \(accounts.count) contas prontas")
    return parts.joined(separator: " · ")
  }

  func notify(_ title: String, _ body: String, _ js: String) {
    // com o app em foco o próprio painel já mostra
    app.log("aviso\(NSApp.isActive ? " (não enviado, app em foco)" : ""): \(title). \(body)")
    guard !NSApp.isActive else { return }
    let c = UNMutableNotificationContent()
    c.title = title
    c.body = body
    c.sound = .default
    c.userInfo = ["js": js]
    UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
  }
  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
    let js = response.notification.request.content.userInfo["js"] as? String
    DispatchQueue.main.async { self.app.reveal(js); done() }
  }
}

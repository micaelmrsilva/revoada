// Vigília: o Mac fica acordado exatamente enquanto há agente trabalhando e volta a
// dormir sozinho quando terminam. Com a tampa aberta basta uma "assertion" do sistema.
// Com a tampa fechada é preciso desligar o sono do sistema (pmset disablesleep), o que
// só funciona depois que o usuário instala a regra de sudo (scripts/vigilia-setup.sh).
// Tudo que é mudado fica anotado em ~/.revoada/vigil.json antes de mudar, pra o app
// (ou o vigia externo, se o app morrer) desfazer.
import AppKit
import IOKit
import IOKit.ps
import IOKit.pwr_mgt

private let graceAfterWork: TimeInterval = 90        // segura acordado um pouco depois do último trabalho
private let batteryFloor = 15                        // na bateria, abaixo disso a tampa fechada volta a dormir
private let maxLidClosedHours: Double = 6            // teto de tempo contínuo com a tampa fechada
private let freezeList = ["com.tinyspeck.slackmacgap", "net.whatsapp.WhatsApp", "com.hnc.Discord"]

final class Vigil {
  unowned let app: AppDelegate
  private var assertion: IOPMAssertionID = 0
  private(set) var holding = false
  private(set) var sleepDisabled = false
  private(set) var lidClosed = false
  private(set) var canLid = false
  private var lastWork = Date.distantPast
  private var closedSince: Date?
  private var frozen: [String] = []     // "pid|início do processo", pra só retomar o que nós paramos
  private var busy = false              // um pmset por vez
  private var note = ""
  private var lastReport = ""
  private let stateURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".revoada/vigil.json")

  init(app: AppDelegate) {
    self.app = app
    recover()
  }

  // ---------- leitura do sistema ----------
  private func readLid() -> Bool {
    let root = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOPMrootDomain"))
    guard root != 0 else { return false }
    defer { IOObjectRelease(root) }
    return (IORegistryEntryCreateCFProperty(root, "AppleClamshellState" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? Bool) ?? false
  }
  // (porcentagem, está na bateria); sem bateria devolve nil
  private func battery() -> (Int, Bool)? {
    guard let blob = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(), let list = IOPSCopyPowerSourcesList(blob)?.takeRetainedValue() as? [CFTypeRef] else { return nil }
    for src in list {
      guard let d = IOPSGetPowerSourceDescription(blob, src)?.takeUnretainedValue() as? [String: Any], d[kIOPSTypeKey] as? String == kIOPSInternalBatteryType,
            let cur = d[kIOPSCurrentCapacityKey] as? Int, let max = d[kIOPSMaxCapacityKey] as? Int, max > 0 else { continue }
      return (cur * 100 / max, d[kIOPSPowerSourceStateKey] as? String == kIOPSBatteryPowerValue)
    }
    return nil
  }
  @discardableResult private func run(_ path: String, _ args: [String], timeout: TimeInterval = 8) -> (Int32, String) {
    let p = Process(), pipe = Pipe()
    p.executableURL = URL(fileURLWithPath: path); p.arguments = args; p.standardOutput = pipe; p.standardError = pipe; p.standardInput = FileHandle.nullDevice
    do { try p.run() } catch { return (-1, "") }
    let limit = Date().addingTimeInterval(timeout)
    while p.isRunning && Date() < limit { usleep(40_000) }
    if p.isRunning { p.terminate(); return (-2, "") }
    return (p.terminationStatus, String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "")
  }
  private func started(_ pid: pid_t) -> String { run("/bin/ps", ["-o", "lstart=", "-p", "\(pid)"]).1.trimmingCharacters(in: .whitespacesAndNewlines) }

  // ---------- estado em disco ----------
  private func save() {
    let deadline = (closedSince ?? Date()).addingTimeInterval(maxLidClosedHours * 3600).timeIntervalSince1970
    let obj: [String: Any] = ["appPid": Int(ProcessInfo.processInfo.processIdentifier), "sleepDisabled": sleepDisabled, "deadline": Int(deadline), "frozen": frozen]
    if let data = try? JSONSerialization.data(withJSONObject: obj) { try? data.write(to: stateURL, options: .atomic) }
  }
  // sobra de uma execução que não fechou direito: desfaz antes de qualquer coisa
  private func recover() {
    guard let data = try? Data(contentsOf: stateURL), let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
    frozen = j["frozen"] as? [String] ?? []
    if !frozen.isEmpty { resumeApps() }
    if j["sleepDisabled"] as? Bool == true {
      let ok = run("/usr/bin/sudo", ["-n", "/usr/bin/pmset", "-a", "disablesleep", "0"]).0 == 0
      app.log("vigília: sobra da execução anterior, sono do sistema \(ok ? "religado" : "NÃO religado (rode: sudo pmset -a disablesleep 0)")")
    }
    save()
  }

  // ---------- acordado com a tampa aberta ----------
  private func hold(_ on: Bool) {
    if on, !holding {
      holding = IOPMAssertionCreateWithName(kIOPMAssertPreventUserIdleSystemSleep as CFString, IOPMAssertionLevel(kIOPMAssertionLevelOn), "Revoada: agentes trabalhando" as CFString, &assertion) == kIOReturnSuccess
    } else if !on, holding {
      IOPMAssertionRelease(assertion); holding = false
    }
  }

  // ---------- acordado com a tampa fechada ----------
  private func setSleepDisabled(_ on: Bool, why: String) {
    guard !busy, on != sleepDisabled else { return }
    busy = true
    if on { sleepDisabled = true; closedSince = Date(); save() } // anota antes de mudar
    DispatchQueue.global().async {
      let ok = self.run("/usr/bin/sudo", ["-n", "/usr/bin/pmset", "-a", "disablesleep", on ? "1" : "0"], timeout: 20).0 == 0
      DispatchQueue.main.async {
        self.busy = false
        if on { if !ok { self.sleepDisabled = false; self.closedSince = nil } }
        else if ok { self.sleepDisabled = false; self.closedSince = nil }
        self.save()
        self.app.log("vigília: sono do sistema \(on ? "desligado" : "religado")\(ok ? "" : " FALHOU") (\(why))")
      }
    }
  }

  private func pauseApps() {
    for app in NSWorkspace.shared.runningApplications where freezeList.contains(app.bundleIdentifier ?? "") {
      let pid = app.processIdentifier, start = started(pid)
      guard !start.isEmpty else { continue }
      frozen.append("\(pid)|\(start)")
      save() // anota antes de parar
      kill(pid, SIGSTOP)
    }
    if !frozen.isEmpty { self.app.log("vigília: \(frozen.count) apps pausados com a tampa fechada") }
  }
  private func resumeApps() {
    for entry in frozen {
      let parts = entry.split(separator: "|", maxSplits: 1).map(String.init)
      // só retoma se ainda é o mesmo processo que paramos
      if parts.count == 2, let pid = pid_t(parts[0]), started(pid) == parts[1] { kill(pid, SIGCONT) }
    }
    frozen = []
    save()
  }

  // ---------- decisão, a cada leitura do estado ----------
  func tick(settings: [String: Any], working: Int) {
    let keep = settings["keepAwake"] as? Bool ?? true
    let lid = settings["lidAwake"] as? Bool ?? false
    let freeze = settings["lidFreeze"] as? Bool ?? false
    let wasClosed = lidClosed
    lidClosed = readLid()
    // a permissão existe se o usuário rodou o script de instalação; ver o arquivo evita chamar o sudo à toa
    canLid = FileManager.default.fileExists(atPath: "/etc/sudoers.d/revoada")
    if working > 0 { lastWork = Date() }
    let wanted = keep && Date().timeIntervalSince(lastWork) < graceAfterWork
    hold(wanted)

    var wantLid = wanted && lid && canLid
    note = ""
    if wantLid, let (pct, onBattery) = battery(), onBattery, pct < batteryFloor { wantLid = false; note = "bateria em \(pct)%: a tampa fechada volta a dormir" }
    if wantLid, ProcessInfo.processInfo.thermalState == .critical { wantLid = false; note = "Mac quente demais: a tampa fechada volta a dormir" }
    if wantLid, let since = closedSince, Date().timeIntervalSince(since) > maxLidClosedHours * 3600 { wantLid = false; note = "passou de \(Int(maxLidClosedHours))h seguidas com o sono desligado" }
    if lid && !canLid { note = "falta instalar a permissão de administrador" }
    setSleepDisabled(wantLid, why: wantLid ? "\(working) trabalhando" : (note.isEmpty ? "ninguém trabalhando" : note))

    if sleepDisabled && lidClosed && !wasClosed {
      // com o sono desligado a tampa não apaga a tela sozinha
      run("/usr/bin/pmset", ["displaysleepnow"])
      if freeze { pauseApps() }
    }
    if !frozen.isEmpty && (!lidClosed || !sleepDisabled) { resumeApps() }
    report()
  }

  // a página mostra isso em Ajustes
  private func report() {
    let obj: [String: Any] = ["holding": holding, "sleepDisabled": sleepDisabled, "lidClosed": lidClosed, "canLid": canLid, "frozen": frozen.count, "note": note]
    guard let data = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]), let text = String(data: data, encoding: .utf8), text != lastReport else { return }
    lastReport = text
    var req = URLRequest(url: URL(string: "\(origin)/api/vigil")!)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "content-type")
    req.setValue(origin, forHTTPHeaderField: "Origin")
    req.httpBody = data
    URLSession.shared.dataTask(with: req).resume()
    app.log("vigília: acordado=\(holding) sono-desligado=\(sleepDisabled) tampa-fechada=\(lidClosed) permissão=\(canLid)\(note.isEmpty ? "" : " (\(note))")")
  }

  // ao sair do app nada fica mudado no sistema
  func shutdown() {
    hold(false)
    resumeApps()
    if sleepDisabled {
      let ok = run("/usr/bin/sudo", ["-n", "/usr/bin/pmset", "-a", "disablesleep", "0"], timeout: 10).0 == 0
      if ok { sleepDisabled = false }
      app.log("vigília: saindo, sono do sistema \(ok ? "religado" : "NÃO religado")")
    }
    save()
  }
}

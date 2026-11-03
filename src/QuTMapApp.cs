using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

namespace QuTMapApp
{
    public class MainForm : Form
    {
        private NotifyIcon trayIcon;
        private ContextMenuStrip trayMenu;
        private Process serverProcess;
        private Label lblStatus;
        private TextBox txtPcUrl;
        private TextBox txtTabletUrl;
        private CheckBox chkAutostart;
        private TextBox txtLog;
        private string appDir;
        private int port = 8765;
        private bool allowExit = false;

        private const string RUN_KEY = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string APP_REG_NAME = "QuTMapGPS";

        public MainForm(bool startMinimized)
        {
            appDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            LoadPortFromConfig();

            Text = "QuTMap — Painel do Serviço";
            Size = new Size(560, 470);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            BackColor = Color.FromArgb(16, 21, 29);
            ForeColor = Color.FromArgb(243, 246, 250);
            Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application; }
            catch { Icon = SystemIcons.Application; }

            BuildUi();
            BuildTray();

            EnsureFirewallPortOpen(false);
            InstallGamePlugins();
            StartNodeServer();

            if (startMinimized)
            {
                WindowState = FormWindowState.Minimized;
                ShowInTaskbar = false;
                Load += (s, e) => Hide();
            }
        }

        private void LoadPortFromConfig()
        {
            try
            {
                string cfgFile = Path.Combine(appDir, "config.json");
                if (File.Exists(cfgFile))
                {
                    string json = File.ReadAllText(cfgFile, Encoding.UTF8);
                    int idx = json.IndexOf("\"port\"");
                    if (idx >= 0)
                    {
                        int colon = json.IndexOf(':', idx);
                        int comma = json.IndexOfAny(new char[] { ',', '}' }, colon);
                        if (colon > 0 && comma > colon)
                        {
                            int p;
                            if (int.TryParse(json.Substring(colon + 1, comma - colon - 1).Trim(), out p))
                            {
                                if (p != 3050 && p != 3051 && p != 3060 && p > 1024) port = p;
                            }
                        }
                    }
                }
            }
            catch { }
        }

        private string GetLanIp()
        {
            try
            {
                foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up) continue;
                    foreach (UnicastIPAddressInformation ip in ni.GetIPProperties().UnicastAddresses)
                    {
                        if (ip.Address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(ip.Address))
                        {
                            string s = ip.Address.ToString();
                            if (s.StartsWith("192.168.")) return s;
                        }
                    }
                }
            }
            catch { }
            return "192.168.1.103";
        }

        private void BuildUi()
        {
            Label lblTitle = new Label
            {
                Text = "QuTMap (ETS2 RBR · ATS · Europa)",
                Font = new Font("Segoe UI", 13f, FontStyle.Bold),
                ForeColor = Color.FromArgb(245, 166, 35),
                Location = new Point(20, 16),
                AutoSize = true
            };
            Controls.Add(lblTitle);

            lblStatus = new Label
            {
                Text = "Iniciando serviço...",
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(52, 211, 153),
                Location = new Point(22, 44),
                AutoSize = true
            };
            Controls.Add(lblStatus);

            string lanIp = GetLanIp();

            Label lblPc = new Label { Text = "2ª Tela no PC:", Location = new Point(22, 78), AutoSize = true };
            txtPcUrl = new TextBox
            {
                Text = "http://127.0.0.1:" + port,
                ReadOnly = true,
                BackColor = Color.FromArgb(26, 34, 48),
                ForeColor = Color.White,
                BorderStyle = BorderStyle.FixedSingle,
                Location = new Point(160, 75),
                Width = 240
            };
            Button btnOpenPc = CreateButton("Abrir na 2ª Tela", new Point(410, 72), new Size(118, 28), Color.FromArgb(245, 166, 35), Color.Black);
            btnOpenPc.Click += (s, e) => OpenMapWindow();

            Label lblTab = new Label { Text = "Tablet / Celular:", Location = new Point(22, 114), AutoSize = true };
            txtTabletUrl = new TextBox
            {
                Text = "http://" + lanIp + ":" + port,
                ReadOnly = true,
                BackColor = Color.FromArgb(26, 34, 48),
                ForeColor = Color.FromArgb(0, 229, 255),
                BorderStyle = BorderStyle.FixedSingle,
                Location = new Point(160, 111),
                Width = 240
            };
            Button btnCopyTab = CreateButton("Copiar Link", new Point(410, 108), new Size(118, 28), Color.FromArgb(37, 99, 235), Color.White);
            btnCopyTab.Click += (s, e) =>
            {
                Clipboard.SetText(txtTabletUrl.Text);
                AppendLog("Link do Tablet copiado: " + txtTabletUrl.Text);
            };

            Controls.AddRange(new Control[] { lblPc, txtPcUrl, btnOpenPc, lblTab, txtTabletUrl, btnCopyTab });

            chkAutostart = new CheckBox
            {
                Text = "Iniciar o serviço do QuTMap automaticamente com o Windows (na bandeja)",
                Location = new Point(22, 152),
                AutoSize = true,
                Checked = IsAutostartEnabled()
            };
            chkAutostart.CheckedChanged += (s, e) => SetAutostart(chkAutostart.Checked);
            Controls.Add(chkAutostart);

            Button btnExtract = CreateButton("Extrair Mapas (.scs)", new Point(22, 188), new Size(162, 34), Color.FromArgb(30, 41, 59), Color.White);
            btnExtract.Click += (s, e) => RunExtractor();

            Button btnPlugin = CreateButton("Instalar Plugin Jogos", new Point(194, 188), new Size(162, 34), Color.FromArgb(30, 41, 59), Color.White);
            btnPlugin.Click += (s, e) => InstallGamePlugins();

            Button btnFirewall = CreateButton("Liberar Porta " + port, new Point(366, 188), new Size(162, 34), Color.FromArgb(30, 41, 59), Color.White);
            btnFirewall.Click += (s, e) => EnsureFirewallPortOpen(true);

            Controls.AddRange(new Control[] { btnExtract, btnPlugin, btnFirewall });

            txtLog = new TextBox
            {
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Vertical,
                BackColor = Color.FromArgb(10, 14, 20),
                ForeColor = Color.FromArgb(203, 213, 225),
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Consolas", 8.8f),
                Location = new Point(22, 234),
                Size = new Size(506, 140)
            };
            Controls.Add(txtLog);

            Button btnMinTray = CreateButton("Minimizar para a Bandeja", new Point(22, 386), new Size(245, 34), Color.FromArgb(16, 185, 129), Color.Black);
            btnMinTray.Click += (s, e) => HideToTray();

            Button btnQuit = CreateButton("Encerrar Serviço", new Point(283, 386), new Size(245, 34), Color.FromArgb(220, 38, 38), Color.White);
            btnQuit.Click += (s, e) => ExitService();

            Controls.AddRange(new Control[] { btnMinTray, btnQuit });
        }

        private Button CreateButton(string text, Point loc, Size sz, Color bg, Color fg)
        {
            Button b = new Button
            {
                Text = text,
                Location = loc,
                Size = sz,
                BackColor = bg,
                ForeColor = fg,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            b.FlatAppearance.BorderSize = 0;
            return b;
        }

        private void BuildTray()
        {
            trayMenu = new ContextMenuStrip();
            trayMenu.Items.Add("Abrir Mapa na 2ª Tela", null, (s, e) => OpenMapWindow());
            trayMenu.Items.Add("Painel de Controle / Configurar", null, (s, e) => ShowFromTray());
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add("Encerrar QuTMap", null, (s, e) => ExitService());

            trayIcon = new NotifyIcon
            {
                Text = "QuTMap (Porta " + port + ")",
                Icon = this.Icon ?? SystemIcons.Application,
                ContextMenuStrip = trayMenu,
                Visible = true
            };
            trayIcon.DoubleClick += (s, e) => OpenMapWindow();
        }

        private void AppendLog(string msg)
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action<string>(AppendLog), msg);
                return;
            }
            txtLog.AppendText("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + msg + Environment.NewLine);
        }

        private bool IsPortListening(int p)
        {
            try
            {
                using (TcpClient c = new TcpClient())
                {
                    IAsyncResult ar = c.BeginConnect("127.0.0.1", p, null, null);
                    bool ok = ar.AsyncWaitHandle.WaitOne(250);
                    if (ok && c.Connected) return true;
                }
            }
            catch { }
            return false;
        }

        private string ResolveNodeExe()
        {
            string p0 = Path.Combine(appDir, "bin", "node.exe");
            if (File.Exists(p0)) return p0;
            string p00 = Path.Combine(appDir, "node.exe");
            if (File.Exists(p00)) return p00;
            string p1 = @"C:\Program Files\nodejs\node.exe";
            if (File.Exists(p1)) return p1;
            string p2 = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
            if (File.Exists(p2)) return p2;
            string p3 = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe");
            if (File.Exists(p3)) return p3;

            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string dir in pathEnv.Split(';'))
            {
                if (string.IsNullOrWhiteSpace(dir)) continue;
                try
                {
                    string candidate = Path.Combine(dir.Trim(), "node.exe");
                    if (File.Exists(candidate)) return candidate;
                }
                catch { }
            }

            return null;
        }

        private void StartNodeServer()
        {
            if (IsPortListening(port))
            {
                lblStatus.Text = "● Serviço Ativo na porta " + port + " (Pronto para jogar)";
                lblStatus.ForeColor = Color.FromArgb(74, 222, 128);
                AppendLog("Servidor já está ativo na porta " + port + ".");
                return;
            }

            string serverScript = Path.Combine(appDir, "server.mjs");
            if (!File.Exists(serverScript))
            {
                lblStatus.Text = "server.mjs não encontrado";
                lblStatus.ForeColor = Color.FromArgb(248, 113, 113);
                AppendLog("Erro: arquivo server.mjs não encontrado em: " + appDir);
                return;
            }

            string nodeExe = ResolveNodeExe();
            if (string.IsNullOrEmpty(nodeExe))
            {
                EnsureNodeDownloadedAndStart();
                return;
            }

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = nodeExe,
                    Arguments = "\"" + serverScript + "\"",
                    WorkingDirectory = appDir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8,
                    StandardErrorEncoding = Encoding.UTF8
                };
                serverProcess = new Process { StartInfo = psi, EnableRaisingEvents = true };
                serverProcess.OutputDataReceived += (s, e) => { if (!string.IsNullOrEmpty(e.Data)) AppendLog(e.Data); };
                serverProcess.ErrorDataReceived += (s, e) => { if (!string.IsNullOrEmpty(e.Data)) AppendLog("[Aviso] " + e.Data); };
                serverProcess.Start();
                serverProcess.BeginOutputReadLine();
                serverProcess.BeginErrorReadLine();
                lblStatus.Text = "● Serviço Ativo na porta " + port + " (Pronto para jogar)";
                lblStatus.ForeColor = Color.FromArgb(74, 222, 128);
            }
            catch (Exception ex)
            {
                lblStatus.Text = "Erro ao iniciar servidor Node.js";
                lblStatus.ForeColor = Color.FromArgb(248, 113, 113);
                AppendLog("Erro ao iniciar node server.mjs: " + ex.Message);
            }
        }

        private void EnsureNodeDownloadedAndStart()
        {
            lblStatus.Text = "Baixando Node.js autônomo...";
            lblStatus.ForeColor = Color.FromArgb(245, 166, 35);
            AppendLog("Node.js não foi encontrado nesta máquina.");
            AppendLog("Baixando executável oficial do Node.js direto para bin\\node.exe (aguarde alguns segundos)...");

            System.Threading.ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    string binDir = Path.Combine(appDir, "bin");
                    Directory.CreateDirectory(binDir);
                    string target = Path.Combine(binDir, "node.exe");
                    string tempTarget = target + ".tmp";

                    using (WebClient wc = new WebClient())
                    {
                        wc.Headers.Add("User-Agent", "QuTMap-Setup");
                        wc.DownloadFile("https://nodejs.org/dist/v20.18.0/win-x64/node.exe", tempTarget);
                    }

                    if (File.Exists(tempTarget))
                    {
                        if (File.Exists(target)) File.Delete(target);
                        File.Move(tempTarget, target);
                    }

                    Invoke(new Action(() =>
                    {
                        AppendLog("Node.js autônomo baixado e pronto em bin\\node.exe!");
                        StartNodeServer();
                    }));
                }
                catch (Exception ex)
                {
                    Invoke(new Action(() =>
                    {
                        lblStatus.Text = "Node.js não instalado";
                        lblStatus.ForeColor = Color.FromArgb(248, 113, 113);
                        AppendLog("Não foi possível baixar o node.exe automaticamente: " + ex.Message);
                        AppendLog("Instale o Node.js em: https://nodejs.org (ou copie o node.exe para bin\\node.exe)");
                    }));
                }
            });
        }

        private void RunExtractor()
        {
            AppendLog("Iniciando extração nativa dos arquivos .scs e .zip...");
            try
            {
                string extScript = Path.Combine(appDir, "extractor.mjs");
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = ResolveNodeExe(),
                    Arguments = "\"" + extScript + "\"",
                    WorkingDirectory = appDir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8
                };
                Process p = new Process { StartInfo = psi, EnableRaisingEvents = true };
                p.OutputDataReceived += (s, e) => { if (!string.IsNullOrEmpty(e.Data)) AppendLog(e.Data); };
                p.ErrorDataReceived += (s, e) => { if (!string.IsNullOrEmpty(e.Data)) AppendLog(e.Data); };
                p.Exited += (s, e) => AppendLog("Extração de mapas concluída!");
                p.Start();
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
            }
            catch (Exception ex)
            {
                AppendLog("Erro ao rodar extrator: " + ex.Message);
            }
        }

        private void EnsureFirewallPortOpen(bool force)
        {
            string ruleName = "QuTMap (Porta " + port + ")";
            try
            {
                if (!force)
                {
                    Process chk = Process.Start(new ProcessStartInfo
                    {
                        FileName = "netsh",
                        Arguments = "advfirewall firewall show rule name=\"" + ruleName + "\"",
                        CreateNoWindow = true,
                        UseShellExecute = false
                    });
                    if (chk != null)
                    {
                        chk.WaitForExit(3000);
                        if (chk.ExitCode == 0)
                        {
                            AppendLog("Firewall: Porta " + port + " já liberada para o Tablet ✓");
                            return;
                        }
                    }
                }

                Process add = Process.Start(new ProcessStartInfo
                {
                    FileName = "netsh",
                    Arguments = "advfirewall firewall add rule name=\"" + ruleName + "\" dir=in action=allow protocol=TCP localport=" + port,
                    Verb = "runas",
                    UseShellExecute = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                });
                if (add != null) add.WaitForExit(8000);
                AppendLog("Firewall: Porta " + port + " liberada com sucesso ✓");
            }
            catch (Exception ex)
            {
                AppendLog("Aviso Firewall: " + ex.Message);
            }
        }

        private void InstallGamePlugins()
        {
            string dllSrc = Path.Combine(appDir, "bin", "scs-telemetry.dll");
            if (!File.Exists(dllSrc)) return;

            string[] candidates = new string[]
            {
                @"E:\SteamLibrary\steamapps\common\Euro Truck Simulator 2",
                @"T:\SteamLibrary\steamapps\common\American Truck Simulator",
                @"C:\Program Files (x86)\Steam\steamapps\common\Euro Truck Simulator 2",
                @"C:\Program Files (x86)\Steam\steamapps\common\American Truck Simulator"
            };

            foreach (string gameDir in candidates)
            {
                try
                {
                    string winX64 = Path.Combine(gameDir, "bin", "win_x64");
                    if (Directory.Exists(winX64))
                    {
                        string plugDir = Path.Combine(winX64, "plugins");
                        Directory.CreateDirectory(plugDir);
                        string dst = Path.Combine(plugDir, "scs-telemetry.dll");
                        if (!File.Exists(dst)) File.Copy(dllSrc, dst, true);
                        AppendLog("Plugin scs-telemetry.dll verificado em: " + gameDir);
                    }
                }
                catch { }
            }
        }

        private void OpenMapWindow()
        {
            string url = "http://127.0.0.1:" + port;
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "msedge",
                    Arguments = "--app=" + url,
                    UseShellExecute = true
                });
            }
            catch
            {
                Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
            }
        }

        private bool IsAutostartEnabled()
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RUN_KEY, false))
                {
                    return k != null && k.GetValue(APP_REG_NAME) != null;
                }
            }
            catch { return false; }
        }

        private void SetAutostart(bool enable)
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RUN_KEY, true))
                {
                    if (enable)
                    {
                        string exePath = Application.ExecutablePath;
                        k.SetValue(APP_REG_NAME, "\"" + exePath + "\" --tray");
                        AppendLog("Inicialização automática com o Windows ATIVADA.");
                    }
                    else
                    {
                        k.DeleteValue(APP_REG_NAME, false);
                        AppendLog("Inicialização automática com o Windows DESATIVADA.");
                    }
                }
            }
            catch (Exception ex)
            {
                AppendLog("Erro ao configurar inicialização: " + ex.Message);
            }
        }

        private void HideToTray()
        {
            Hide();
            ShowInTaskbar = false;
            trayIcon.ShowBalloonTip(2000, "QuTMap Ativo", "Rodando em segundo plano na porta " + port + ".", ToolTipIcon.Info);
        }

        private void ShowFromTray()
        {
            Show();
            WindowState = FormWindowState.Normal;
            ShowInTaskbar = true;
            Activate();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!allowExit && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                HideToTray();
                return;
            }
            base.OnFormClosing(e);
        }

        private void ExitService()
        {
            allowExit = true;
            trayIcon.Visible = false;
            try
            {
                if (serverProcess != null && !serverProcess.HasExited)
                {
                    serverProcess.Kill();
                }
            }
            catch { }
            Application.Exit();
        }

        [STAThread]
        public static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            bool trayMode = args != null && args.Length > 0 && args[0] == "--tray";
            Application.Run(new MainForm(trayMode));
        }
    }
}

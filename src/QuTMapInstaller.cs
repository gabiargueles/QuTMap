using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

namespace QuTMapInstaller
{
    public class InstallerForm : Form
    {
        private TextBox txtInstallDir;
        private TextBox txtEts2Dir;
        private TextBox txtAtsDir;
        private CheckBox chkDesktopShortcut;
        private CheckBox chkAutostart;
        private CheckBox chkInstallPlugin;
        private CheckBox chkExtractMaps;
        private ProgressBar progressBar;
        private Label lblProgress;
        private Button btnInstall;

        public InstallerForm()
        {
            Text = "Instalador — QuTMap (ETS2 RBR & ATS)";
            Size = new Size(580, 470);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            BackColor = Color.FromArgb(16, 21, 29);
            ForeColor = Color.FromArgb(243, 246, 250);
            Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
            Icon = SystemIcons.Shield;

            BuildUi();
        }

        private void BuildUi()
        {
            Label lblHeader = new Label
            {
                Text = "Instalação do QuTMap",
                Font = new Font("Segoe UI", 14f, FontStyle.Bold),
                ForeColor = Color.FromArgb(245, 166, 35),
                Location = new Point(22, 16),
                AutoSize = true
            };
            Label lblSub = new Label
            {
                Text = "Mapa em tempo real (Porta 8765) com 0.00m de erro para 2ª Tela e Tablet.",
                ForeColor = Color.FromArgb(148, 163, 184),
                Location = new Point(24, 44),
                AutoSize = true
            };
            Controls.AddRange(new Control[] { lblHeader, lblSub });

            string defaultDir = Directory.Exists(@"C:\Claude\Projetos")
                ? @"C:\Claude\Projetos\QuTMap"
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Apps", "QuTMap");

            Label l1 = new Label { Text = "Pasta de Instalação:", Location = new Point(24, 80), AutoSize = true };
            txtInstallDir = new TextBox
            {
                Text = defaultDir,
                Location = new Point(24, 102),
                Width = 430,
                BackColor = Color.FromArgb(26, 34, 48),
                ForeColor = Color.White,
                BorderStyle = BorderStyle.FixedSingle
            };
            Button btnBrowse = new Button
            {
                Text = "Procurar...",
                Location = new Point(462, 100),
                Size = new Size(86, 26),
                BackColor = Color.FromArgb(30, 41, 59),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat
            };
            btnBrowse.Click += (s, e) =>
            {
                using (FolderBrowserDialog fbd = new FolderBrowserDialog())
                {
                    if (fbd.ShowDialog() == DialogResult.OK) txtInstallDir.Text = fbd.SelectedPath;
                }
            };

            Label l2 = new Label { Text = "Pasta do Euro Truck Simulator 2:", Location = new Point(24, 136), AutoSize = true };
            txtEts2Dir = new TextBox
            {
                Text = DetectGamePath("Euro Truck Simulator 2", @"E:\SteamLibrary\steamapps\common\Euro Truck Simulator 2"),
                Location = new Point(24, 158),
                Width = 524,
                BackColor = Color.FromArgb(26, 34, 48),
                ForeColor = Color.White,
                BorderStyle = BorderStyle.FixedSingle
            };

            Label l3 = new Label { Text = "Pasta do American Truck Simulator:", Location = new Point(24, 190), AutoSize = true };
            txtAtsDir = new TextBox
            {
                Text = DetectGamePath("American Truck Simulator", @"T:\SteamLibrary\steamapps\common\American Truck Simulator"),
                Location = new Point(24, 212),
                Width = 524,
                BackColor = Color.FromArgb(26, 34, 48),
                ForeColor = Color.White,
                BorderStyle = BorderStyle.FixedSingle
            };

            chkDesktopShortcut = new CheckBox
            {
                Text = "Criar atalhos na Área de Trabalho e no Menu Iniciar",
                Location = new Point(24, 250),
                AutoSize = true,
                Checked = true
            };
            chkAutostart = new CheckBox
            {
                Text = "Iniciar o serviço do QuTMap automaticamente com o Windows (em segundo plano)",
                Location = new Point(24, 278),
                AutoSize = true,
                Checked = true
            };
            chkInstallPlugin = new CheckBox
            {
                Text = "Instalar plugin (scs-telemetry.dll) no ETS2/ATS e liberar Porta 8765 no Firewall",
                Location = new Point(24, 306),
                AutoSize = true,
                Checked = true
            };
            chkExtractMaps = new CheckBox
            {
                Text = "Extrair / copiar mapas (.scs e Mapa RBR) e abrir o QuTMap ao concluir",
                Location = new Point(24, 334),
                AutoSize = true,
                Checked = true
            };

            lblProgress = new Label
            {
                Text = "Pronto para instalar.",
                ForeColor = Color.FromArgb(52, 211, 153),
                Location = new Point(24, 366),
                AutoSize = true
            };

            progressBar = new ProgressBar
            {
                Location = new Point(24, 390),
                Size = new Size(370, 28),
                Minimum = 0,
                Maximum = 100,
                Value = 0
            };

            btnInstall = new Button
            {
                Text = "Instalar Agora",
                Location = new Point(406, 388),
                Size = new Size(142, 32),
                BackColor = Color.FromArgb(245, 166, 35),
                ForeColor = Color.Black,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 10f, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            btnInstall.FlatAppearance.BorderSize = 0;
            btnInstall.Click += (s, e) => RunInstallation();

            Controls.AddRange(new Control[]
            {
                l1, txtInstallDir, btnBrowse,
                l2, txtEts2Dir,
                l3, txtAtsDir,
                chkDesktopShortcut, chkAutostart, chkInstallPlugin, chkExtractMaps,
                lblProgress, progressBar, btnInstall
            });
        }

        private string DetectGamePath(string gameFolder, string preferred)
        {
            if (Directory.Exists(preferred)) return preferred;
            string[] drives = new string[] { "C", "D", "E", "F", "G", "T" };
            foreach (string d in drives)
            {
                string p1 = d + @":\SteamLibrary\steamapps\common\" + gameFolder;
                if (Directory.Exists(p1)) return p1;
                string p2 = d + @":\Program Files (x86)\Steam\steamapps\common\" + gameFolder;
                if (Directory.Exists(p2)) return p2;
            }
            return preferred;
        }

        private void RunInstallation()
        {
            btnInstall.Enabled = false;
            string targetDir = txtInstallDir.Text.Trim();

            try
            {
                lblProgress.Text = "Criando estrutura de pastas...";
                progressBar.Value = 15;
                Application.DoEvents();
                Directory.CreateDirectory(targetDir);

                // Extrai pacote embutido QuTMapCore.zip
                lblProgress.Text = "Extraindo arquivos do aplicativo e binários de telemetria...";
                progressBar.Value = 35;
                Application.DoEvents();

                Assembly asm = Assembly.GetExecutingAssembly();
                using (Stream s = asm.GetManifestResourceStream("QuTMapCore.zip"))
                {
                    if (s != null)
                    {
                        string tempZip = Path.Combine(Path.GetTempPath(), "QuTMapCore_" + Guid.NewGuid().ToString("N") + ".zip");
                        using (FileStream fs = new FileStream(tempZip, FileMode.Create, FileAccess.Write))
                        {
                            s.CopyTo(fs);
                        }
                        using (ZipArchive ar = ZipFile.OpenRead(tempZip))
                        {
                            foreach (ZipArchiveEntry entry in ar.Entries)
                            {
                                string fullPath = Path.Combine(targetDir, entry.FullName.Replace('/', '\\'));
                                if (string.IsNullOrEmpty(entry.Name))
                                {
                                    Directory.CreateDirectory(fullPath);
                                    continue;
                                }
                                Directory.CreateDirectory(Path.GetDirectoryName(fullPath));
                                entry.ExtractToFile(fullPath, true);
                            }
                        }
                        File.Delete(tempZip);
                    }
                }

                // Grava config.json personalizado com os caminhos escolhidos e porta 8765
                string modDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Euro Truck Simulator 2", "mod");
                string cfgJson = "{\n" +
                    "  \"port\": 8765,\n" +
                    "  \"ets2Path\": \"" + txtEts2Dir.Text.Trim().Replace("\\", "\\\\") + "\",\n" +
                    "  \"atsPath\": \"" + txtAtsDir.Text.Trim().Replace("\\", "\\\\") + "\",\n" +
                    "  \"ets2ModPath\": \"" + modDir.Replace("\\", "\\\\") + "\",\n" +
                    "  \"units\": { \"speed\": \"kmh\", \"distance\": \"km\", \"weight\": \"kg\" },\n" +
                    "  \"defaultCameraMode\": \"flat-north\"\n" +
                    "}\n";
                File.WriteAllText(Path.Combine(targetDir, "config.json"), cfgJson, Encoding.UTF8);

                // Instala scs-telemetry.dll nos jogos e libera Porta 8765 no Firewall do Windows
                if (chkInstallPlugin.Checked)
                {
                    lblProgress.Text = "Instalando plugin scs-telemetry.dll e liberando Porta 8765 no Firewall...";
                    progressBar.Value = 55;
                    Application.DoEvents();
                    string dllSrc = Path.Combine(targetDir, "bin", "scs-telemetry.dll");
                    if (File.Exists(dllSrc))
                    {
                        foreach (string gDir in new string[] { txtEts2Dir.Text.Trim(), txtAtsDir.Text.Trim() })
                        {
                            if (!string.IsNullOrEmpty(gDir) && Directory.Exists(Path.Combine(gDir, "bin", "win_x64")))
                            {
                                string pDir = Path.Combine(gDir, "bin", "win_x64", "plugins");
                                Directory.CreateDirectory(pDir);
                                File.Copy(dllSrc, Path.Combine(pDir, "scs-telemetry.dll"), true);
                            }
                        }
                    }

                    try
                    {
                        string ruleName = "QuTMap (Porta 8765)";
                        Process chk = Process.Start(new ProcessStartInfo
                        {
                            FileName = "netsh",
                            Arguments = "advfirewall firewall show rule name=\"" + ruleName + "\"",
                            CreateNoWindow = true,
                            UseShellExecute = false
                        });
                        bool alreadyOpen = false;
                        if (chk != null)
                        {
                            chk.WaitForExit(3000);
                            alreadyOpen = (chk.ExitCode == 0);
                        }
                        if (!alreadyOpen)
                        {
                            Process fw = Process.Start(new ProcessStartInfo
                            {
                                FileName = "netsh",
                                Arguments = "advfirewall firewall add rule name=\"" + ruleName + "\" dir=in action=allow protocol=TCP localport=8765",
                                Verb = "runas",
                                UseShellExecute = true,
                                WindowStyle = ProcessWindowStyle.Hidden
                            });
                            if (fw != null) fw.WaitForExit(8000);
                        }
                    }
                    catch { }
                }

                // Cria atalhos na Área de Trabalho e Menu Iniciar
                string exePath = Path.Combine(targetDir, "QuTMap.exe");
                if (chkDesktopShortcut.Checked && File.Exists(exePath))
                {
                    lblProgress.Text = "Criando atalhos na Área de Trabalho e Menu Iniciar...";
                    progressBar.Value = 70;
                    Application.DoEvents();
                    CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "QuTMap.lnk"), exePath, targetDir);
                    CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "QuTMap.lnk"), exePath, targetDir);
                }

                // Registra inicialização automática com o Windows
                if (chkAutostart.Checked && File.Exists(exePath))
                {
                    using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                    {
                        if (k != null) k.SetValue("QuTMapGPS", "\"" + exePath + "\" --tray");
                    }
                }

                // Verifica se os mapas já estão em data/ ou extrai agora
                string dataDir = Path.Combine(targetDir, "data");
                Directory.CreateDirectory(dataDir);
                if (chkExtractMaps.Checked && !File.Exists(Path.Combine(dataDir, "ets2_rbr.json")) && !File.Exists(Path.Combine(dataDir, "ats.json")))
                {
                    lblProgress.Text = "Extraindo mapas nativos (.scs / Mapa RBR)... aguarde ~6s";
                    progressBar.Value = 85;
                    Application.DoEvents();
                    string nodeExe = File.Exists(@"C:\Program Files\nodejs\node.exe") ? @"C:\Program Files\nodejs\node.exe" : "node";
                    Process p = Process.Start(new ProcessStartInfo
                    {
                        FileName = nodeExe,
                        Arguments = "\"" + Path.Combine(targetDir, "extractor.mjs") + "\"",
                        WorkingDirectory = targetDir,
                        UseShellExecute = false,
                        CreateNoWindow = true
                    });
                    if (p != null) p.WaitForExit(25000);
                }

                progressBar.Value = 100;
                lblProgress.Text = "Instalação concluída com sucesso!";
                Application.DoEvents();

                if (chkExtractMaps.Checked && File.Exists(exePath))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = exePath,
                        WorkingDirectory = targetDir,
                        UseShellExecute = true
                    });
                }

                MessageBox.Show(
                    "QuTMap instalado com sucesso em:\n" + targetDir + "\n\n" +
                    "• 2ª Tela no PC: http://127.0.0.1:8765\n" +
                    "• Tablet na Rede: http://192.168.1.103:8765",
                    "Instalação Concluída",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
                Close();
            }
            catch (Exception ex)
            {
                MessageBox.Show("Erro durante a instalação: " + ex.Message, "Erro", MessageBoxButtons.OK, MessageBoxIcon.Error);
                btnInstall.Enabled = true;
            }
        }

        private void CreateShortcut(string lnkPath, string targetExe, string workDir)
        {
            try
            {
                string vbs = Path.Combine(Path.GetTempPath(), "mklnk_" + Guid.NewGuid().ToString("N") + ".vbs");
                string script =
                    "Set ws = WScript.CreateObject(\"WScript.Shell\")\r\n" +
                    "Set sc = ws.CreateShortcut(\"" + lnkPath + "\")\r\n" +
                    "sc.TargetPath = \"" + targetExe + "\"\r\n" +
                    "sc.WorkingDirectory = \"" + workDir + "\"\r\n" +
                    "sc.Description = \"QuTMap (ETS2 RBR & ATS)\"\r\n" +
                    "sc.Save\r\n";
                File.WriteAllText(vbs, script, Encoding.Default);
                Process p = Process.Start(new ProcessStartInfo { FileName = "wscript", Arguments = "//B //NoLogo \"" + vbs + "\"", CreateNoWindow = true, UseShellExecute = false });
                if (p != null) p.WaitForExit(3000);
                File.Delete(vbs);
            }
            catch { }
        }

        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm());
        }
    }
}

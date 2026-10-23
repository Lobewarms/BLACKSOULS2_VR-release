BLACK SOULS II VR  (版本 2026.10.23-10)
==================================

用第一人称 VR (PCVR) 游玩黑魂2 (BLACK SOULS II) 的非官方粉丝 MOD。
- 不包含任何游戏数据。需要你自己的 BLACK SOULS II 游戏文件夹。
- 不会修改原作游戏文件夹和原作存档。原作存档 (Save01～16) 可以在 VR 中读取。
- 原作存档的难度 (在图书馆选择的 0～9) 也照样生效。要更改请像原作一样在图书馆更改。
- VR 存档 (自动存档 + 16 个存档位) 和设置保存在本文件夹的 saves 文件夹中。


需要
----
- Windows 10/11，最新版 Chrome 或 Edge
- PCVR 头显：SteamVR 头显，或 Meta Quest (Link / Air Link / Virtual Desktop)
- (可选) RPG Maker VX Ace RTP：安装后启动器会自动找到。没有的话，部分地图的一些图块会显示为空，气泡 (包括表情) 也不会显示。


启动
----
1. 解压到原作游戏文件夹以外的位置。
2. 运行 BlacksoulsVR.exe。(如果出现「Windows 已保护你的电脑」，请点「更多信息」→「仍要运行」)
3. 用「浏览...」选择 BLACK SOULS II 游戏文件夹 (Game.exe 所在的文件夹)，然后按「启动」。
4. 游戏窗口打开后戴上头显，按窗口下方的 ENTER VR。
   勾选「游戏窗口打开后自动进入 VR」后会自动进入。
5. 游玩期间请不要关闭启动器。

在启动器右上角选择语言。原作的台词和名字保持你所拥有的原作的样子。


SteamVR
-------
- 在 SteamVR 关闭的状态下按「添加到 SteamVR 库」，即可从 SteamVR 库直接启动。
- 要在 VR 中查看桌面，请勾选「用 SteamVR 运行」，并用系统键打开 SteamVR 仪表板。
- 添加后如果移动了此文件夹，请运行一次启动器；删除文件夹前请按「从 SteamVR 移除」。


操作
----
操作方法写在 CONTROLS_zh.txt 中。
在菜单 (VR: Y, PC: Tab) 中可以存档、读档、选择誓约，以及调整转向、战斗和画面设置。


战斗
----
靠近敌人后，敌人会实时发起攻击。

敌人准备攻击时，会被命中的范围显示在地面上，范围被填满的瞬间攻击就会到来。请在那之前离开范围。
- 橙色：普通攻击。闪避或防御。
- 紫色：必中。闪避的无敌躲不开。请离开范围或防御。
- 粉色 (边框闪烁、低沉的警告音)：普通防御挡不住。请闪避或完美防御。
- 深红色：只能离开范围或完美防御。
- 直线：飞来的攻击。发射前会一直跟着你，发射后再向旁边躲开。紫色的弹会一直追踪，请用盾牌挡住。

- 防御：举起盾牌可以减少伤害。飞来的攻击必须打在盾牌上才能挡住。
- 完美防御：在被打中前一刻举盾，不受伤害、回复 HP，并在一段时间内提升攻击力和防御力。
- 闪避：冲刺的瞬间无敌 (紫色、深红色攻击除外)。
- 蓄力斩：伤害最高 2 倍。
- 破防：大多数敌人只有在蓄力 (脚下有金色光环) 或防御时才能被破防，成功后敌人会陷入无防备状态。
  对无防备的敌人使出蓄力斩或非常用力的一击，可以造成大量伤害。
  敌人脚下出现红色光环时，是无法破防的大招。
- 眩晕槽：敌人 HP 条下方的白色条。每次用武器攻击都会减少，减到零时，敌人会像被破防一样陷入无防备状态。
- 身体泛起蓝色微光的敌人，被打后会立刻反击。微光刚出现时可以破防。
- 短时间内连续挥砍，从第三下开始伤害会降低 (红色数字)。
- 盾牌栏装上枪后，按破防键就会开枪 (贯穿敌人)。此时无法防御，但在攻击打中前一刻射中那个敌人就算完美防御，
  并取消敌人的行动。
- 有「杀害」选项的 NPC，在 3 秒内用武器砍两次，就和选择了那个选项一样。
- 击败的敌人在离开地图再回来后会复活；在篝火休息会让所有敌人复活。
- 在菜单 → 设置 → 战斗 / 画面设置中，可以更改破防判定、击败的敌人复活、受击晃动、被重击击飞、敌人穿墙。


合作（开发中）
--------------
好友可以进入你的世界，和你一起行动、战斗。
- 主机：运行 coop_server.cmd（需要 Python 3），然后 菜单 → 合作 → 开放我的世界（本机的合作服务器）。
  把服务器窗口里显示的连接PIN告诉好友；同一路由器的好友用窗口里的本机地址，互联网上的好友用你的公网 IP。
  通过互联网邀请时，请在路由器上把端口 28471（TCP）转发到本机；Windows 防火墙弹出窗口时也勾选“公用网络”再允许。
  如果路由器管理页面上的外部（WAN）IP 与公网 IP 不同（运营商共享 IP、双路由器），转发端口后外面也进不来，请使用下面的外部服务器。
  请从家以外的网络（如手机流量）测试连接。
- 客人：菜单 → 合作 → 前往好友的世界 → 添加服务器 → IP、端口、PIN。
- 在本机开服务器时，好友会看到你的IP，路由器也要开放端口。这种方式的合作只和信得过的人进行。
  和不认识的人请使用外部服务器（见下面的“搭建外部服务器”）。
- 外部服务器：在那里运行 coop_server.py，然后在 开放我的世界（其他地方的合作服务器）里输入服务器IP和主机PIN。
- 更新游戏后，也请把服务器的 coop_server.py 换成同一版本并重新启动。
- 服务器规则和连接PIN由主机在 菜单 → 合作 中更改。
- 注意：关闭随主机移动地图（客人单独行动）目前还非常不稳定。
- 注意：开启客人先开始Boss战后，游戏可能会以主机未预期的方式推进。
- 作为客人期间不会存档，结束后会回到进入前原样的自己的世界。
- 聊天·语音：菜单 → 合作 → 聊天·语音。聊天显示为说话人头上的对话气泡（PC 可输入任何语言；VR 键盘为英文，按 韩/英 键可输入韩文）。
  语音聊天仅在选择“说话和收听”期间使用麦克风（第一次浏览器会请求麦克风权限）。
- 在社区服务器（菜单 → 合作 → 社区服务器）中的进度另行保存，不会接到本篇存档。要带回本篇，请在标题画面用“读取社区服务器存档”读取后再存档。
- 开启社区服务器：运行 community_server.cmd（需要 Python 3），并开放端口 28472（TCP）。进入的人在
  菜单 → 合作 → 添加社区服务器 中输入 IP、端口 28472 和服务器窗口显示的连接 PIN。
  在外部服务器上，请把 world_server.py 和 coop_server.py 一起上传，用 python3 world_server.py 启动。


搭建外部服务器（示例）
----------------------
只需上传 coop_server.py。服务器使用 Ubuntu，端口为 28471（TCP）。
ssh、scp、icacls 在自己电脑的 PowerShell 中输入，其他命令在登录服务器的窗口中输入。

Oracle Cloud（免费）
1. 注册：主区域（Home Region）以后无法更改。列表中没有韩国时，选择日本（大阪或东京）。
2. 先创建网络：菜单（≡）→ Networking → Virtual cloud networks → Start VCN Wizard
   → Create VCN with Internet Connectivity → Start VCN Wizard → 只填名称，Next → Create
3. 创建服务器：左上角菜单（≡）→ Compute → Instances → Create instance
   - Name：任意名称
   - Image and shape → Image 的 Change image → Ubuntu → Canonical Ubuntu 22.04（或 24.04）→ Select image
   - Shape 的 Change shape → Virtual machine → Ampere 的 VM.Standard.A1.Flex（OCPU 1，内存 6GB）
     → Select shape。如果因“Out of capacity”无法创建，改选 AMD 的 VM.Standard.E2.1.Micro。
     （两者都是标有“Always Free-eligible”的免费规格）
   - Security：保持不变
   - Networking：Select existing virtual cloud network → 第2步创建的 VCN 和名称中带 public subnet 的子网，
     打开“Automatically assign public IPv4 address”
   - Add SSH keys：Generate a key pair for me → Save private key（会下载 .key 文件 - 丢失后无法登录，请妥善保存）
   - Storage：保持不变（在免费范围内）
   - 点最下方的 Create → 状态变为 Running 后，记下实例页面的 Public IP address
4. 开放端口：菜单（≡）→ Networking → Virtual cloud networks → 第2步创建的 VCN → Security 选项卡
   → Security Lists 的 Default Security List → Security rules 选项卡 → Add Ingress Rules
   - Source Type：CIDR / Source CIDR：0.0.0.0/0 / IP Protocol：TCP / Destination Port Range：28471
   - 其余留空，点 Add Ingress Rules
5. 密钥文件权限（自己电脑的 PowerShell，第一次执行一次 - 不执行的话 ssh 会拒绝该密钥）。
   密钥文件放在 C 盘（例：C:\Users\你的用户名\.ssh）- U盘或 exFAT 格式的磁盘无法设置权限。
   密钥文件名按下载时的名称填写（例：ssh-key-2026-10-14.key）：
   icacls "C:\密钥路径\ssh-key.key" /inheritance:r /grant:r "$($env:USERNAME):R"
6. 上传（PowerShell，在 coop_server.py 所在的文件夹中）：
   scp -i "C:\密钥路径\ssh-key.key" coop_server.py ubuntu@服务器IP:~/
7. 登录（PowerShell）：ssh -i "C:\密钥路径\ssh-key.key" ubuntu@服务器IP
   第一次对“Are you sure you want to continue connecting?”回答 yes。之后的命令在这个窗口中输入。
   - 请使用普通的 PowerShell（或终端）窗口，不要用 PowerShell ISE - ISE 中无法输入文字。
   - 提示找不到 'scp'/'ssh' 时，用完整路径运行
     （例：& "C:\Windows\System32\OpenSSH\ssh.exe" -i ... ubuntu@服务器IP）。
8. 开放服务器内的防火墙（Oracle 的 Ubuntu 一开始是关闭的）：
   sudo iptables -I INPUT -p tcp --dport 28471 -j ACCEPT && sudo netfilter-persistent save

Google Cloud（美国区域的 e2-micro 免费，首尔区域收费）
1. Compute Engine → VM实例 → 创建实例
   - 区域：us-west1、us-central1、us-east1 之一 / 机器类型：e2-micro
   - 启动磁盘：更改 → Ubuntu，磁盘类型“标准永久性磁盘”30GB 以内（其他类型收费）
   - 创建 → 记下外部IP
2. 开放端口：VPC网络 → 防火墙 → 创建防火墙规则
   - 目标：网络中的所有实例，来源IPv4范围 0.0.0.0/0，TCP 28471 → 创建
3. VM列表的 SSH 按钮 → 用打开的窗口上方的“上传文件”（UPLOAD FILE）上传 coop_server.py。
   之后的命令在这个窗口中输入。

在服务器窗口中（两者相同）
- 启动：nohup python3 coop_server.py > coop.log 2>&1 &
- 查看连接PIN和主机PIN：cat coop.log
- 查看是否在运行：pgrep -af coop_server
- 停止：pkill -f coop_server
- 服务器重启后自动启动（只需一次）：
  (crontab -l 2>/dev/null; echo "@reboot cd $HOME && python3 coop_server.py > coop.log 2>&1") | crontab -
- 在游戏中：主机在 菜单 → 合作 → 开放我的世界（其他地方的合作服务器）输入服务器IP和主机PIN，
  好友在 前往好友的世界 → 添加服务器 输入服务器IP、端口 28471 和连接PIN。
新版本：重新上传文件后（Google Cloud 不会覆盖，而是另存为 'coop_server_(1).py' 等）执行这一行：
pkill -f coop_server; f=$(ls -t coop_server*.py | head -1); [ "$f" = coop_server.py ] || mv -f "$f" coop_server.py; for x in coop_server*.py; do [ "$x" = coop_server.py ] || rm -f -- "$x"; done; nohup python3 coop_server.py > coop.log 2>&1 &


更新
----
把新版本的 zip 解压覆盖到同一个文件夹即可。存档、设置和游戏文件夹位置都会保留。


遇到问题时
----------
- 无法识别游戏文件夹：请选择包含 Game.exe 和 Data 文件夹 (或 Game.rgss3a) 的文件夹。
- 显示「VR NOT SUPPORTED」：请先启动 SteamVR 或 Quest Link，关闭游戏窗口后再按一次「启动」。
- 退出 VR 后再次进入：按钮会短暂显示「VR ...」，变回 ENTER VR 后再按即可。
- 打开仪表板或摘下头显时，游戏会暂停。
- 只有使用 SteamVR 时手柄才会振动。
- 端口错误：请在启动器中更换端口号。
- 有两块显卡的笔记本，游戏窗口打开时画面可能会闪一下 (正常)。


本 MOD 为非官方粉丝作品，与原作制作者无关。
原作：寿司勇者トロ  https://x.com/toro_yori_ebi
MOD 制作：Allobe  https://www.youtube.com/@Allobe

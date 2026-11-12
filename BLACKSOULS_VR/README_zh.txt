BLACK SOULS II VR  (版本 2026.11.12-7)
==================================

用第一人称 VR (PCVR) 游玩黑魂2 (BLACK SOULS II) 的非官方粉丝 MOD。
- 不包含任何游戏数据。需要你自己的 BLACK SOULS II 游戏文件夹。
- 原作存档 (Save01～16) 可以在 VR 中读取。原作存档的难度 (在图书馆选择的 0～9) 也照样生效，
  要更改请像原作一样在图书馆更改。
- VR 存档和设置保存在本文件夹的 saves 文件夹中。
- 用启动器的「规则编辑器」制作的规则保存在 saves 文件夹的 user_rules.json 中，优先于黑魂专用修正。


需要
----
- Windows 10/11，最新版 Chrome 或 Edge
- PCVR 头显：SteamVR 头显，或 Meta Quest (Link / Air Link / Virtual Desktop)
- RPG Maker VX Ace RTP (免费，安装后启动器会自动找到)
  在 https://www.rpgmakerweb.com/run-time-package 的「RPG Maker VX Ace」处点 Download Run Time Package 下载，
  解压后用 RTP100 文件夹里的 Setup.exe 安装。


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
- 盾牌栏装上枪后，按破防键就会开枪 (贯穿敌人)。此时无法防御，但在攻击打中前一刻射中那个敌人就算完美防御，
  并取消敌人的行动。
- 有「杀害」选项的 NPC，在 3 秒内用武器砍两次，就和选择了那个选项一样。
- 击败的敌人在离开地图再回来后会复活；在篝火休息会让所有敌人复活。
- 在菜单 → 设置 → 战斗 / 画面设置中，可以更改破防判定、击败的敌人复活、受击晃动、被重击击飞、敌人穿墙。


合作（开发中）
--------------
好友可以进入你的世界，和你一起行动、战斗。
开服务器的一方是主机，进入的一方是客人。客人只需要看 [4]。

用哪种方式开
- 同一个家（同一路由器）的好友：[1] → [2]
- 别的家里的好友（信得过的人）：[1] → [2] → [3]
- 和不认识的人玩，或者 [3] 行不通时：下面的“搭建外部服务器”（不会暴露你的 IP）

[1] 安装 Python 3（只有开服务器的人需要，第一次一次即可）
  1. 打开 https://www.python.org/downloads/ ，不要点大按钮（Download Python install manager），而是点它下面
     “Or get the standalone installer for Python 3.x.x”里的“Python 3.x.x”，下载安装程序并运行。
  2. 在第一个画面最下方一定要勾选“Add python.exe to PATH”，然后点“Install Now”。
  3. 出现“Setup was successful”后点 Close。
  - 如果服务器窗口显示“Python was not found”或“Python 3 is needed”，说明没有安装，或者第 2 步没有勾选。
    再运行一次安装程序：出现第一个画面就从第 2 步开始；出现“Modify”就点 Modify → Next →
    勾选“Add Python to environment variables”→ Install。然后关掉服务器窗口再重新打开。

[2] 在自己的电脑上开服务器
  1. 双击本文件夹里的 coop_server.cmd，会打开一个黑色的服务器窗口。
     - 如果询问是否运行，点“运行”（如果是「Windows 已保护你的电脑」，点「更多信息」→「仍要运行」）。
     - 弹出 Windows 防火墙的提示窗口时，把“专用网络”和“公用网络”都勾上，再点“允许访问”。
       如果直接关掉了或只勾了一个：在开始菜单搜索“防火墙”，打开“Windows Defender 防火墙”，点左侧的
       “允许应用或功能通过 Windows Defender 防火墙”→“更改设置”→ 列表里每一行 Python 都勾上“专用”和“公用”→“确定”。
     - 一起玩的时候不要关闭服务器窗口。关闭后服务器就停止了。
  2. 在服务器窗口里确认两样东西：
     - 连接PIN：写着“give this to your friends”那一行的 6 位数字，告诉好友
     - 本机地址：写着“friends on the same router”那一行的地址（例：192.168.0.10），告诉同一个家里的好友
  3. 启动游戏，选择 菜单（VR: Y，PC: Tab）→ 合作 →“开放我的世界（本机的合作服务器）”。
  4. 把地址、端口 28471 和连接PIN告诉好友。
     - 同一个家里的好友：地址 = 服务器窗口里的本机地址
     - 别的家里的好友：地址 = 公网 IP（[3] 的第 2 步）。要做完 [3] 好友才能进来。
  - 连接PIN和规则在游戏的 菜单 → 合作 中更改（也可以请离、屏蔽）。
  - 用这种方式，好友能看到你的 IP。只和信得过的人这样玩。

[3] 邀请别的家里的好友（在路由器上转发端口）
  1. 打开路由器管理页面：在命令提示符（在开始菜单搜索 cmd）里输入 ipconfig，
     把“默认网关”的地址（例：192.168.0.1）输入浏览器的地址栏。
     登录用的用户名和密码一般写在路由器机身的标签上。
  2. 查看公网 IP：看管理页面上的外部（WAN、互联网）IP。
     - 以 10. / 172.16～172.31. / 192.168. 开头：这台路由器前面还有一台路由器（例如运营商的光猫或路由器后面又接了
       自己的路由器）。把这台路由器外部（WAN）信息里的网关地址输入浏览器，打开前面那台路由器的管理页面，在那里再做一遍
       这第 2 步。第 3 步的规则两台路由器都要建（前面那台路由器规则里的内部 IP 地址是后面那台路由器的外部 IP）。
     - 以 100.64～100.127 开头，或者打不开前面那台路由器的管理页面：运营商给的是多户共用的 IP（大内网），在家里开不了
       服务器（很多运营商可以申请公网 IP）。请使用下面的“搭建外部服务器”。
     - 其他地址：这就是公网 IP，也就是要告诉别的家里的好友的地址（例：203.0.113.45）。
  3. 添加端口转发规则：在“端口转发”“虚拟服务器”“端口映射”等菜单里添加一条规则。
     - 内部 IP 地址：服务器窗口里的本机地址
     - 协议：TCP
     - 外部端口和内部端口：都填 28471
     → 保存（应用）。
  4. 好友按 [4] 进不来时（游戏里显示“无法连接服务器”）：确认第 3 步的规则（内部 IP、TCP、28471）已经保存，
     [2] 第 1 步的防火墙也允许了公用网络。如果杀毒软件带防火墙功能，也在那里允许 Python。
  - 电脑重启后，本机地址可能会变。如果和第 3 步的内部 IP 不一样了，请修改规则。

[4] 进入好友的世界（客人）
  1. 向主机要地址（IP）、端口和连接PIN。
  2. 选择 菜单 → 合作 →“前往好友的世界”→“添加服务器（输入IP、端口、PIN）”。
  3. IP 是 12 位数字，每段输入三位。不足三位的段在前面补 0。
     例：192.168.0.10 → 192 168 000 010
  4. 输入端口（一开始就填好了 28471）和连接PIN 就能进入。
     输入过的服务器，下次在“前往好友的世界”的列表里选择即可。
  - 作为客人期间不会存档，结束后会回到进入前原样的自己的世界。

一起玩的时候
- 聊天·语音：菜单 → 合作 → 聊天·语音。聊天显示为说话人头上的对话气泡（PC 可输入任何语言；VR 键盘为英文，
  按 韩/英 键可输入韩文）。
  语音聊天仅在选择“说话和收听”期间使用麦克风（第一次浏览器会请求麦克风权限）。
- 注意：关闭随主机移动地图（客人单独行动）目前还非常不稳定。
- 注意：开启客人先开始Boss战后，游戏可能会以主机未预期的方式推进。
- 更新游戏后，也请关闭服务器窗口再重新打开（外部服务器见下面的“换成新版本”）。

社区服务器（大家共享的一个世界）
- 进入：菜单 → 合作 →“社区服务器 1”或“社区服务器 2”。
  别人开的社区服务器，在“添加社区服务器（IP·端口·PIN）”里输入那个服务器的地址、端口（一开始就填好了 28472）和连接PIN。
- 在社区服务器中的进度另行保存，不会接到本篇存档。要带回本篇，请在标题画面用“读取社区服务器存档”读取后再存档。
- 自己开：双击 community_server.cmd。安装 Python（[1]）、防火墙允许（[2] 的第 1 步）、端口转发（[3]）都和合作服务器
  一样，只是端口为 28472。把窗口里的连接PIN告诉大家，自己也在“添加社区服务器”里输入窗口里的本机地址进入。
  管理员PIN 在游戏的合作菜单里更改规则时使用。
  要在外部服务器上开，请看下面“搭建外部服务器”中的“开社区服务器时”。


搭建外部服务器（免费的云服务器）
--------------------------------
在免费的云上搭一个服务器：不会暴露你的 IP，关掉自己的电脑也一直开着。服务器使用 Ubuntu，端口为 28471（TCP）。
命令从这里复制、粘贴（右键或 Ctrl+V）后按 Enter。输入命令的地方有两个：
- PowerShell：用文件资源管理器打开本文件夹，在上方的地址栏输入 powershell 后按 Enter 打开的窗口
- 服务器窗口：登录到服务器的窗口（Oracle 在第 7 步、Google 在第 3 步打开）
命令里的 服务器IP 换成服务器的公网 IP，"C:\密钥路径\ssh-key.key"（连同引号）换成密钥文件的路径：
右键点击密钥文件 →「复制文件地址」（Windows 10 按住 Shift 再右键 →「复制为路径」），然后粘贴到那里。

■ Oracle Cloud（免费）
- Oracle 可能会停止 7 天里几乎闲着的免费服务器（合作服务器通常就是这样）。停止后在实例页面点 Start 即可；
  设置过自动启动的话（“启动服务器”第 3 步，社区服务器是第 5 步），服务器也会自动运行。想让它不被停止，
  就把账号升级为 Pay As You Go（在免费范围内不收费）。
1. 注册：主区域（Home Region）以后不能更改。请选离你和好友最近的区域（例如日本、韩国、新加坡）。
2. 先建网络：菜单（≡）→ Networking → Virtual cloud networks → Start VCN Wizard
   → Create VCN with Internet Connectivity → Start VCN Wizard → 只填名字，Next → Create
3. 创建服务器：左上角菜单（≡）→ Compute → Instances → Create instance
   - Name：任意名字
   - Image and shape → Image 的 Change image → Ubuntu → Canonical Ubuntu 22.04（或 24.04）→ Select image
   - Shape 的 Change shape → Virtual machine → Ampere 的 VM.Standard.A1.Flex（OCPU 1，内存 6GB）→ Select shape
     如果提示“Out of capacity”创建不了，请改选 AMD 的 VM.Standard.E2.1.Micro。
     （两者都是标有“Always Free-eligible”的免费规格）
   - Security：保持不变
   - Networking：Select existing virtual cloud network → 选第 2 步建的 VCN 和名字里带 public subnet 的子网，
     并打开“Automatically assign public IPv4 address”
   - Add SSH keys：Generate a key pair for me → Save private key
     （会下载一个 .key 文件。丢了就进不了服务器，请不要删除）
   - Storage：保持不变（在免费范围内）
   - 点最下面的 Create → 状态变成 Running 后，记下实例页面的 Public IP address（服务器IP）
4. 开放端口：菜单（≡）→ Networking → Virtual cloud networks → 第 2 步建的 VCN → Security 选项卡
   → Security Lists 的 Default Security List → Security rules 选项卡 → Add Ingress Rules
   - Source Type: CIDR / Source CIDR: 0.0.0.0/0 / IP Protocol: TCP / Destination Port Range: 28471
   - 其他留空，点 Add Ingress Rules
5. 密钥文件的权限（PowerShell，只需第一次 - 不做的话 ssh 会拒绝这个密钥）：
   icacls "C:\密钥路径\ssh-key.key" /inheritance:r /grant:r "$($env:USERNAME):R"
   密钥文件请放在 C 盘（放在“下载”文件夹里不动也可以）。放在 U 盘或 exFAT 的盘上无法设置权限。
6. 上传文件（PowerShell）：
   scp -i "C:\密钥路径\ssh-key.key" coop_server.py ubuntu@服务器IP:~/
   第一次连接时出现的“Are you sure you want to continue connecting”请输入 yes。
7. 登录服务器（PowerShell）：ssh -i "C:\密钥路径\ssh-key.key" ubuntu@服务器IP
   现在这个窗口就是服务器窗口。
   - 第 6、7 步如果提示找不到“scp”或“ssh”，请用完整路径运行
     （例：& "C:\Windows\System32\OpenSSH\ssh.exe" -i "C:\密钥路径\ssh-key.key" ubuntu@服务器IP / scp 是 scp.exe）。
8. 打开服务器内部的防火墙（服务器窗口 - Oracle 的 Ubuntu 一开始是关着的）：
   sudo iptables -I INPUT -p tcp --dport 28471 -j ACCEPT && sudo netfilter-persistent save
9. 接着做下面的“启动服务器”。

■ Google Cloud（美国区域的 e2-micro 免费）
- 首次注册会得到可在 90 天内使用的 300 美元赠金。绑定的银行卡上可能会暂时出现一笔预授权，这只是验证，不是扣款，
  会在 1～14 个工作日内（视银行而定）消失。试用期间不会扣费，90 天后只要不自己升级也不会扣费。
  赠金还有余额时，东京（asia-northeast1）、香港（asia-east2）等原本收费的区域也可以用赠金。
- 90 天过后或赠金用完，服务器会停止。要继续使用，请在那之前在结算（Billing）页面点“升级”（Upgrade，有的页面是
  “激活”/Activate）升级为付费账号（停止后 30 天内升级还能恢复，之后会被删除）。升级后，超出免费范围的部分会自动
  从银行卡扣费：美国区域的 e2-micro 一台和 30GB 标准磁盘仍然免费，但其他区域，以及服务器发出的数据中每月超过 1GB
  的部分会收费。多人长时间玩的话，发出数据每月 10TB 以内免费的 Oracle 更合适。
1. Compute Engine → VM实例 → 创建实例
   - 区域：us-west1、us-central1、us-east1 之一（只用 90 天的话，东京 asia-northeast1 等也可以）/ 机器类型：e2-micro
   - 启动磁盘：更改 → Ubuntu，磁盘类型“标准永久性磁盘”30GB 以内（其他类型收费）
   - 创建 → 记下外部IP（服务器IP）
2. 开放端口：VPC网络 → 防火墙 → 创建防火墙规则
   - 目标：网络中的所有实例 / 来源IPv4范围：0.0.0.0/0 / 勾选 TCP，端口 28471 → 创建
3. 点 VM 列表里的 SSH 按钮。打开的窗口就是服务器窗口。
   用窗口上方的“上传文件”（UPLOAD FILE）上传本文件夹里的 coop_server.py。
4. 接着做下面的“启动服务器”。

■ 启动服务器（Oracle、Google 相同，在服务器窗口中）
1. 启动：nohup python3 coop_server.py > coop.log 2>&1 &
2. 查看PIN：cat coop.log → 记下“give this to your friends”那一行的连接PIN，和“only to host from another PC”那一行的主机PIN。
3. 让服务器重启后也自动启动（只需一次）：
   (crontab -l 2>/dev/null; echo "@reboot cd $HOME && python3 coop_server.py > coop.log 2>&1") | crontab -
4. 在游戏中（地址是服务器IP，不是 coop.log 里“friends on the same router”那一行的地址）
   - 主机：菜单 → 合作 →“开放我的世界（其他地方的合作服务器）”→“添加服务器（输入IP、端口、PIN）”
     → 服务器IP、端口 28471、连接PIN、主机PIN
   - 好友：和 [4] 一样，输入服务器IP、端口 28471、连接PIN
- 关掉服务器窗口，服务器也会一直运行。再次进入时，Oracle 用第 7 步的 ssh，Google 用 SSH 按钮。
- 查看是否在运行：pgrep -af coop_server（什么都不显示就是停了 - 用第 1 步启动）
- 停止：pkill -f coop_server
- 谁都进不来时：先确认是否在运行，再检查开放端口的步骤（Oracle 第 4、8 步，Google 第 2 步）。

■ 换成新版本
1. 再上传一次新的 coop_server.py（Oracle：第 6 步 / Google：上传文件）。
2. 在服务器窗口输入这一行。它会停止服务器，把最新上传的文件改为 coop_server.py，然后重新启动
   （Google 不会覆盖同名文件，而是另存为 'coop_server_(1).py' 等）：
   pkill -f coop_server; f=$(ls -t coop_server*.py | head -1); [ "$f" = coop_server.py ] || mv -f "$f" coop_server.py; for x in coop_server*.py; do [ "$x" = coop_server.py ] || rm -f -- "$x"; done; nohup python3 coop_server.py > coop.log 2>&1 &

■ 开社区服务器时（端口 28472）
1. 同样做 Oracle 的第 1～7 步或 Google 的第 1～3 步，但开放端口（Oracle 第 4 步、Google 第 2 步）改为 28472，
   文件要把 coop_server.py 和 world_server.py 都上传（Oracle 的第 6 步改用这一行）：
   scp -i "C:\密钥路径\ssh-key.key" coop_server.py world_server.py ubuntu@服务器IP:~/
2. Oracle 在服务器窗口里用这一行代替第 8 步：
   sudo iptables -I INPUT -p tcp --dport 28472 -j ACCEPT && sudo netfilter-persistent save
3. 启动：nohup python3 world_server.py > world.log 2>&1 &
4. 查看PIN：cat world.log → 记下“the PIN players add the server with”那一行的连接PIN，和“to change the rules in the game”
   那一行的管理员PIN。
5. 让服务器重启后也自动启动（只需一次）：
   (crontab -l 2>/dev/null; echo "@reboot cd $HOME && python3 world_server.py > world.log 2>&1") | crontab -
6. 在游戏中：菜单 → 合作 →“添加社区服务器（IP·端口·PIN）”→ 服务器IP、端口 28472、连接PIN
- 查看是否在运行：pgrep -af world_server / 停止：pkill -f world_server
- 新版本：把两个文件再上传一次，然后在服务器窗口输入这一行：
  pkill -f world_server; for n in coop_server world_server; do f=$(ls -t $n*.py | head -1); [ "$f" = $n.py ] || mv -f "$f" $n.py; for x in $n*.py; do [ "$x" = $n.py ] || rm -f -- "$x"; done; done; nohup python3 world_server.py > world.log 2>&1 &
- 同一台服务器也可以同时开合作服务器。这时 28471 和 28472 两个端口都要开放。


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

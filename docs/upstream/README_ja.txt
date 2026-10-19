BLACK SOULS II VR  (バージョン 2026.10.18-1)
==================================

ブラックソウルズ2 を一人称 VR (PCVR) で遊ぶための非公式ファンMODです。
- ゲームデータは含まれていません。ブラックソウルズ2 のゲームフォルダが必要です。
- 原作のゲームフォルダと原作のセーブは変更しません。原作のセーブ (Save01〜16) は VR で読み込めます。
- 原作のセーブの難易度 (図書館で選ぶ 0〜9) もそのまま適用されます。変えるときは原作どおり図書館で変えてください。
- VR のセーブ (オート + 16スロット) と設定は、このフォルダの saves フォルダに保存されます。


必要なもの
----------
- Windows 10/11、最新の Chrome または Edge
- PCVR ヘッドセット: SteamVR 対応ヘッドセット、または Meta Quest (Link / Air Link / Virtual Desktop)
- (任意) RPG Maker VX Ace RTP: インストールされていればランチャーが自動で見つけます。ないと一部マップのタイルの
  一部が空に見え、吹き出し (エモートも) が出ません。


起動
----
1. 原作のゲームフォルダとは別の場所に解凍します。
2. BlacksoulsVR.exe を実行します。(「Windows によって PC が保護されました」と出たら「詳細情報」→「実行」)
3. 「参照...」でブラックソウルズ2 のゲームフォルダ (Game.exe があるフォルダ) を選び、「起動」を押します。
4. ゲームウィンドウが開いたらヘッドセットをかぶり、ウィンドウ下の ENTER VR を押します。
   「ゲームウィンドウが開いたら自動で VR 開始」をオンにしておくと自動で入ります。
5. 遊んでいる間はランチャーを閉じないでください。

言語はランチャー右上で選びます。原作のセリフ・名前はお持ちの原作のままです。


SteamVR
-------
- SteamVR を終了した状態で「SteamVR ライブラリに登録」を押すと、SteamVR のライブラリから直接起動できます。
- VR の中でデスクトップを見るには「SteamVR で実行」をオンにし、システムボタンで SteamVR ダッシュボードを開きます。
- 登録したあとこのフォルダを移動したらランチャーを一度起動し、フォルダを消す前には「SteamVR 登録を解除」を
  押してください。


操作
----
操作方法は CONTROLS_ja.txt にあります。
メニュー (VR: Y, PC: Tab) でセーブ・ロード・誓約と、移動・回転・戦闘・画面の設定ができます。


戦闘
----
敵は近づくとリアルタイムで襲ってきます。

敵が攻撃の準備に入ると当たる範囲が床に表示され、中が満ちた瞬間に攻撃が来ます。その前に範囲の外へ出てください。
- オレンジ: 通常攻撃。回避するか防御してください。
- 紫: 必中。回避の無敵では避けられません。範囲の外へ出るか防御してください。
- ピンク (縁が点滅し、低い警告音): 普通の防御では防げません。回避するか完璧防御してください。
- 深紅: 範囲の外へ出るか、完璧防御するしかありません。
- 直線: 飛んでくる攻撃。撃つ直前までこちらを追ってくるので、撃たれたあとで横へよけてください。紫の弾は
  最後まで追ってくるので盾で防いでください。

- 防御: 盾を構えるとダメージが減ります。飛んでくる攻撃は盾に当たらないと防げません。
- 完璧防御: 当たる直前に盾を構えるとダメージがなく、HP が回復し、しばらく攻撃力・防御力が上がります。
- 回避: ダッシュした瞬間は無敵です (紫・深紅の攻撃は除く)。
- 溜め斬り: ダメージが最大 2 倍です。
- ブレイク: ほとんどの敵は力を溜めているとき (足元に金色の輪) か防御中にしか効かず、効くと敵が無防備になります。
  無防備の敵に溜め斬りか、とても強く振った一撃を入れると大ダメージです。
  足元に赤い輪が出たら、ブレイクの効かない大技が来ます。
- グロッキー: 敵の HP バーの下の白いバーです。武器で攻撃するたびに減り、なくなるとブレイクと同じく無防備になります。
- 体が青く揺らめく敵は、叩くとすぐに反撃してきます。揺らめき始めた直後はブレイクが効きます。
- 短い間に続けて振ると、3 回目からダメージが下がります (赤い数字)。
- 盾枠に銃をつけると、ブレイクボタンでその銃を撃ちます (敵を貫通)。そのあいだ防御はできませんが、
  攻撃が当たる直前にその敵に当てると完璧防御になり、敵の行動がキャンセルされます。
- 「殺害」の選択肢がある NPC は、3 秒以内に武器で 2 回斬るとその選択肢を選んだのと同じになります。
- 倒した敵はマップを出て戻ると復活し、篝火で休むとすべて復活します。
- メニューの戦闘・画面設定で、ブレイク判定・倒した敵の復活・被弾時の揺れ・強い攻撃で吹き飛ぶ・敵が壁を通過を
  変えられます。


協力（開発中）
--------------
友達があなたの世界に入って、一緒に歩き、戦えます。
- ホスト: coop_server.cmd を実行し（Python 3 が必要）、メニュー → 協力 → 自分の世界を開く（このPCの協力サーバー）。
  サーバーの窓に出る接続PINとこのPCのアドレスを友達に伝えてください。
  インターネット越しに呼ぶときは、ルーターでポート 28471（TCP）をこのPCへ開放してください。
- ゲスト: メニュー → 協力 → 友達の世界へ行く → サーバーを追加 → IP・ポート・PIN。
- このPCでサーバーを開くと、友達に自分のIPが見え、ルーターのポートが開きます。この方法の協力は信頼できる人とだけにしてください。
  知らない人とは外部サーバーを使ってください（下の「外部サーバーの作り方」）。
- 外部サーバー: そこで coop_server.py を実行し、自分の世界を開く（別の場所の協力サーバー）でサーバーのIPとホストPINを入れます。
- ゲームを新しいバージョンにしたら、サーバーの coop_server.py も同じものに替えて再起動してください。
- サーバーのルールと接続PINは、ホストがメニュー → 協力で変えます。
- 注意：一緒にマップ移動をオフにする（ゲストが別行動する）のは、まだ非常に不安定です。
- 注意：ゲストが先にボス戦を開始をオンにすると、意図しない形でゲームが進むことがあります。
- ゲストの間はセーブされず、終わると入る前のままの自分の世界に戻ります。
- 開発者サーバー（メニュー → 協力 → 開発者サーバー）での進行は別に保存され、本編のセーブにはつながりません。本編に持ってくるには、タイトルの「開発者サーバーのセーブを読み込む」で読み込んでからセーブしてください。


外部サーバーの作り方（例）
--------------------------
アップロードするのは coop_server.py だけです。サーバーは Ubuntu、ポートは 28471（TCP）です。
ssh・scp・icacls は自分のPCの PowerShell で、ほかのコマンドはサーバーに接続したウィンドウで入力します。

Oracle Cloud（無料）
1. 登録: ホームリージョン（Home Region）は後から変更できません。韓国が一覧になければ日本（大阪または東京）を選びます。
2. 先にネットワークを作る: メニュー（≡）→ Networking → Virtual cloud networks → Start VCN Wizard
   → Create VCN with Internet Connectivity → Start VCN Wizard → 名前だけ入れて Next → Create
3. サーバーを作る: 左上のメニュー（≡）→ Compute → Instances → Create instance
   - Name: 好きな名前
   - Image and shape → Image の Change image → Ubuntu → Canonical Ubuntu 22.04（または 24.04）→ Select image
   - Shape の Change shape → Virtual machine → Ampere の VM.Standard.A1.Flex（OCPU 1、メモリ 6GB）
     → Select shape。「Out of capacity」で作れないときは AMD の VM.Standard.E2.1.Micro を選びます。
     （どちらも「Always Free-eligible」と表示された無料のシェイプです）
   - Security: そのまま
   - Networking: Select existing virtual cloud network → 2で作った VCN と、名前に public subnet が入ったサブネット、
     「Automatically assign public IPv4 address」をオンにします
   - Add SSH keys: Generate a key pair for me → Save private key（.key ファイルがダウンロードされます - なくすと接続できないので保管）
   - Storage: そのまま（無料の範囲内）
   - 一番下の Create → 状態が Running になったらインスタンス画面の Public IP address を控えます
4. ポートを開く: メニュー（≡）→ Networking → Virtual cloud networks → 2で作った VCN → Security タブ
   → Security Lists の Default Security List → Security rules タブ → Add Ingress Rules
   - Source Type: CIDR / Source CIDR: 0.0.0.0/0 / IP Protocol: TCP / Destination Port Range: 28471
   - ほかは空欄のまま Add Ingress Rules
5. キーファイルの権限（自分のPCの PowerShell、最初の1回 - しないと ssh がキーを拒否します）。
   キーファイルは Cドライブ（例: C:\Users\自分の名前\.ssh）に置きます - USBや exFAT のドライブでは権限を設定できません。
   キーファイル名はダウンロードした名前のまま入れます（例: ssh-key-2026-10-14.key）:
   icacls "C:\キーのパス\ssh-key.key" /inheritance:r /grant:r "$($env:USERNAME):R"
6. アップロード（PowerShell、coop_server.py のあるフォルダーで）:
   scp -i "C:\キーのパス\ssh-key.key" coop_server.py ubuntu@サーバーIP:~/
7. 接続（PowerShell）: ssh -i "C:\キーのパス\ssh-key.key" ubuntu@サーバーIP
   初回は「Are you sure you want to continue connecting?」に yes。以降のコマンドはこのウィンドウに入力します。
   - PowerShell ISE ではなく通常の PowerShell（またはターミナル）を使います - ISE では文字が入力できません。
   - 'scp'/'ssh' が見つからないときはフルパスで実行します
     （例: & "C:\Windows\System32\OpenSSH\ssh.exe" -i ... ubuntu@サーバーIP）。
8. サーバー内のファイアウォールを開く（Oracle の Ubuntu は最初は閉じています）:
   sudo iptables -I INPUT -p tcp --dport 28471 -j ACCEPT && sudo netfilter-persistent save

Google Cloud（米国リージョンの e2-micro は無料、ソウルは有料）
1. Compute Engine → VMインスタンス → インスタンスを作成
   - リージョン: us-west1、us-central1、us-east1 のいずれか / マシンタイプ: e2-micro
   - ブートディスク: 変更 → Ubuntu、ディスクの種類「標準永続ディスク」30GB 以下（ほかの種類は有料）
   - 作成 → 外部IPを控えます
2. ポートを開く: VPCネットワーク → ファイアウォール → ファイアウォールルールを作成
   - ターゲット: ネットワーク上のすべてのインスタンス、ソースIPv4範囲 0.0.0.0/0、TCP 28471 → 作成
3. VM一覧の SSH ボタン → 開いたウィンドウ上部の「ファイルをアップロード」（UPLOAD FILE）で coop_server.py を送ります。
   以降のコマンドはこのウィンドウに入力します。

サーバーのウィンドウで（どちらも）
- 起動: nohup python3 coop_server.py > coop.log 2>&1 &
- 接続PIN・ホストPINを見る: cat coop.log
- 動いているか見る: pgrep -af coop_server
- 止める: pkill -f coop_server
- サーバーが再起動しても自動で起動する（1回だけ）:
  (crontab -l 2>/dev/null; echo "@reboot cd $HOME && python3 coop_server.py > coop.log 2>&1") | crontab -
- ゲームでは: ホストはメニュー → 協力 → 自分の世界を開く（別の場所の協力サーバー）にサーバーIPとホストPIN、
  友達は友達の世界へ行く → サーバーを追加 にサーバーIP、ポート 28471、接続PIN。
新しい版: ファイルを再アップロードしてから（Google Cloud は上書きせず 'coop_server_(1).py' のように溜まります）この1行:
pkill -f coop_server; f=$(ls -t coop_server*.py | head -1); [ "$f" = coop_server.py ] || mv -f "$f" coop_server.py; for x in coop_server*.py; do [ "$x" = coop_server.py ] || rm -f -- "$x"; done; nohup python3 coop_server.py > coop.log 2>&1 &


アップデート
------------
新しいバージョンの zip を同じフォルダに上書き解凍してください。セーブ・設定・ゲームフォルダの場所はそのまま残ります。


困ったときは
------------
- ゲームフォルダが認識されない: Game.exe と Data フォルダ (または Game.rgss3a) があるフォルダを選んでください。
- 「VR NOT SUPPORTED」と出る: 先に SteamVR か Quest Link を起動し、ゲームウィンドウを閉じて「起動」をもう一度
  押してください。
- VR から出たあともう一度入る: ボタンが少しの間「VR ...」になり、ENTER VR に戻ったら押してください。
- VR接続に時間がかかるときは進行状況の表示に従い、ヘッドセットを準備したままお待ちください。
- キャンセル後は接続の終了を待ちます。起動や終了が止まった場合、表示された「VR接続をリセット」を押し、完了を待ってから再度入ってください。
- 終了を確認できない場合は可能ならセーブし、ゲームウィンドウを開き直してください。Quest Link自体が固まった場合はヘッドセットとLinkを再起動し、Meta LinkのPCアプリの警告も確認してください。
- ダッシュボードを開いたり、ヘッドセットを外したりするとゲームが止まります。
- コントローラーの振動は SteamVR を使うときだけです。
- ポートのエラー: ランチャーのポート番号を変えてみてください。
- グラフィックチップが 2 つあるノート PC では、ゲームウィンドウが開くときに画面が一度ちらつくことがあります (正常)。


この MOD は非公式のファン制作物で、原作の制作者とは関係ありません。
原作: 寿司勇者トロ  https://x.com/toro_yori_ebi
MOD 制作: Allobe  https://www.youtube.com/@Allobe

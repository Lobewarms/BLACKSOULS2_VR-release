BLACK SOULS II VR  (버전 2026.10.23-14)
==================================

블랙소울2를 1인칭 VR(PCVR)로 플레이하는 비공식 팬 모드입니다.
- 게임 데이터는 들어 있지 않습니다. 블랙소울2 게임 폴더가 필요합니다.
- 원작 게임 폴더와 원작 세이브는 바꾸지 않습니다. 원작 세이브(Save01~16)는 VR에서 불러올 수 있습니다.
- 원작 세이브의 난이도(도서관에서 고르는 0~9)도 그대로 적용됩니다. 바꾸려면 원작처럼 도서관에서 바꾸세요.
- VR 세이브(오토 + 16칸)와 설정은 이 폴더의 saves 폴더에 저장됩니다.


필요한 것
---------
- Windows 10/11, 최신 Chrome 또는 Edge
- PCVR 헤드셋: SteamVR 헤드셋, 또는 Meta Quest(Link / Air Link / Virtual Desktop)
- (선택) RPG Maker VX Ace RTP: 설치되어 있으면 런처가 알아서 찾습니다. 없으면 몇몇 맵의 일부 타일이 비어 보이고, 말풍선(감정표현 포함)이 안 나옵니다.


실행
----
1. 압축을 원작 게임 폴더와 다른 곳에 풉니다.
2. BlacksoulsVR.exe를 실행합니다. ('Windows의 PC 보호' 창이 뜨면 '추가 정보' → '실행')
3. '찾아보기...'로 블랙소울2 게임 폴더(Game.exe가 있는 폴더)를 고르고 '실행'을 누릅니다.
4. 게임 창이 뜨면 헤드셋을 쓰고 창 아래의 ENTER VR을 누릅니다.
   '게임 창이 뜨면 VR 자동 시작'을 켜 두면 알아서 들어갑니다.
5. 플레이하는 동안 런처를 닫지 마세요.

언어는 런처 오른쪽 위에서 고릅니다. 원작의 대사·이름은 가지고 있는 원작 그대로 나옵니다.


SteamVR
-------
- SteamVR을 끈 상태에서 'SteamVR 라이브러리에 등록'을 누르면 SteamVR 라이브러리에서 바로 실행할 수 있습니다.
- VR 안에서 데스크톱을 보려면 'SteamVR로 실행'을 켜고, 시스템 버튼으로 SteamVR 대시보드를 여세요.
- 등록한 뒤 이 폴더를 옮겼으면 런처를 한 번 실행하고, 폴더를 지우기 전에는 'SteamVR 등록 해제'를 누르세요.


조작
----
조작법은 CONTROLS_ko.txt에 있습니다.
메뉴(VR: Y, PC: Tab)에서 세이브·불러오기·서약과 회전·전투·화면 설정을 할 수 있습니다.


전투
----
적은 가까이 가면 실시간으로 덤벼듭니다.

적이 공격을 준비하면 맞을 범위가 바닥에 뜨고, 안이 다 차는 순간 공격이 들어옵니다. 그 전에 범위 밖으로 나가세요.
- 주황: 보통 공격. 피하거나 방어하세요.
- 보라: 필중. 회피의 무적으로는 못 피합니다. 범위 밖으로 나가거나 방어하세요.
- 분홍(테두리가 깜박이고 낮은 경고음): 보통 방어로는 못 막습니다. 피하거나 완벽 방어하세요.
- 진홍: 범위 밖으로 나가거나 완벽 방어하는 수밖에 없습니다.
- 직선: 날아오는 공격. 쏘기 직전까지 나를 따라오니, 쏜 뒤에 옆으로 비키세요. 보라색 탄은 끝까지 따라오니
  방패로 막으세요.

- 방어: 방패를 들면 피해가 줄어듭니다. 날아오는 공격은 방패에 맞아야 막힙니다.
- 완벽 방어: 맞기 직전에 방패를 들면 피해가 없고 HP가 회복되며, 잠시 공격력·방어력이 오릅니다.
- 회피: 대시하는 순간 무적입니다(보라·진홍 공격 제외).
- 힘 모아 베기: 피해가 최대 2배입니다.
- 브레이크: 대부분의 적은 기를 모을 때(발밑에 금색 고리)나 방어할 때만 통하고, 통하면 적이 무방비가 됩니다.
  무방비인 적에게 힘 모아 베기나 아주 세게 휘두른 일격을 넣으면 큰 피해를 줍니다.
  발밑에 붉은 고리가 뜨면 브레이크가 안 통하는 큰 공격이 옵니다.
- 그로기: 적의 체력바 아래 흰 줄입니다. 무기로 칠 때마다 줄고, 다 깎이면 브레이크처럼 무방비가 됩니다.
- 몸이 푸른빛으로 일렁이는 적은 때리면 곧바로 반격합니다. 그 빛이 생긴 직후에는 브레이크가 통합니다.
- 짧은 사이에 계속 휘두르면 세 번째부터 피해가 줄어듭니다(빨간 숫자).
- 방패 칸에 총을 끼면 브레이크 버튼으로 그 총을 쏩니다(적 관통). 이때는 방어를 못 하는 대신,
  공격이 닿기 직전에 그 적을 맞히면 완벽 방어가 되며, 적의 행동이 취소됩니다.
- '살해한다' 선택지가 있는 NPC는 3초 안에 무기로 두 번 베면 그 선택지를 고른 것과 같습니다.
- 쓰러뜨린 적은 맵을 나갔다 오면 되살아나고, 화톳불에서 쉬면 모두 되살아납니다.
- 메뉴 → 설정 → 전투·화면 설정에서 브레이크 판정, 쓰러뜨린 적 부활, 피격 흔들림, 강한 공격에 밀려남, 적이 벽 통과를
  바꿀 수 있습니다.


협력 (만드는 중)
---------------
친구가 내 세계에 들어와 함께 다니고 싸울 수 있습니다.
- 호스트: coop_server.cmd를 실행하고(Python 3 필요), 메뉴 → 협력 → 내 세계 열기 (이 PC의 협력 서버).
  서버 창에 나오는 접속 PIN과, 같은 공유기의 친구에게는 서버 창의 이 PC 주소를, 인터넷의 친구에게는 공인 IP를 알려 주세요.
  인터넷으로 부를 때는 공유기에서 포트 28471(TCP)를 이 PC로 열고, Windows 방화벽 창이 뜨면 '공용 네트워크'도 체크하고 허용을 누르세요.
  공유기 관리 화면의 외부(WAN) IP가 공인 IP와 다르면(통신사 공유 IP, 공유기 두 대) 포트를 열어도 밖에서 들어올 수 없습니다.
  그때는 아래 외부 서버를 쓰세요. 접속 확인은 같은 집이 아닌 곳(휴대폰 데이터 등)에서 하세요.
- 게스트: 메뉴 → 협력 → 친구의 세계로 가기 → 새 서버 추가 → IP, 포트, PIN.
- 이 PC에서 서버를 열면 친구에게 내 IP가 보이고 공유기 포트가 열립니다. 이렇게 하는 협력은 믿을 수 있는 사람끼리만 하세요.
  모르는 사람과는 외부 서버를 쓰세요 (아래 "외부 서버 만들기").
- 외부 서버: 그 서버에서 coop_server.py를 실행하고, 내 세계 열기 (다른 곳의 협력 서버)에서 서버 IP와 호스트 PIN을 넣으세요.
- 게임을 새 버전으로 바꾸면 서버의 coop_server.py도 같은 것으로 바꾸고 다시 켜세요.
- 서버 규칙과 접속 PIN은 호스트가 메뉴 → 협력에서 바꿉니다.
- 주의: 함께 맵 이동을 끄면(게스트가 따로 행동) 아직 매우 불안정합니다.
- 주의: 게스트가 먼저 보스전 시작을 켜면 의도하지 않게 게임이 진행될 수 있습니다.
- 게스트로 있는 동안은 저장되지 않고, 끝나면 들어가기 전 그대로 자기 세계로 돌아갑니다.
- 채팅·음성: 메뉴 → 협력 → 채팅·음성. 채팅은 말한 사람 머리 위 말풍선으로 보입니다 (VR 키보드는 한/영 키로 한글 입력).
  음성 채팅은 '말하기와 듣기'를 고른 동안만 마이크를 씁니다 (처음 한 번 브라우저가 마이크 권한을 묻습니다).
- 커뮤니티 서버(메뉴 → 협력 → 커뮤니티 서버)의 진행은 따로 저장되며 본편 세이브와 이어지지 않습니다. 본편으로 가져오려면 타이틀의 '커뮤니티 서버 세이브 불러오기'로 불러온 뒤 저장하세요.
- 커뮤니티 서버 열기: community_server.cmd를 실행하고(Python 3 필요) 포트 28472(TCP)를 열어 주세요. 들어오는 사람은
  메뉴 → 협력 → 커뮤니티 서버 추가에 IP, 포트 28472, 서버 창의 접속 PIN을 넣습니다.
  외부 서버에서는 world_server.py와 coop_server.py를 함께 올리고 python3 world_server.py로 켭니다.


외부 서버 만들기 (예시)
----------------------
올리는 파일은 coop_server.py 하나뿐입니다. 서버는 Ubuntu, 포트는 28471(TCP)입니다.
ssh·scp·icacls는 내 PC의 PowerShell에서, 나머지 명령은 서버에 접속한 창에서 입력합니다.

오라클 클라우드 (무료)
1. 가입: 홈 영역(Home Region)은 나중에 바꿀 수 없습니다. 한국이 목록에 없으면 일본(오사카 또는 도쿄)을 고르세요.
2. 네트워크 먼저 만들기: 메뉴(≡) → Networking → Virtual cloud networks → Start VCN Wizard
   → Create VCN with Internet Connectivity → Start VCN Wizard → 이름만 넣고 Next → Create
3. 서버 만들기: 왼쪽 위 메뉴(≡) → Compute → Instances → Create instance
   - Name: 아무 이름
   - Image and shape → Image의 Change image → Ubuntu → Canonical Ubuntu 22.04 (또는 24.04) → Select image
   - Shape의 Change shape → Virtual machine → Ampere의 VM.Standard.A1.Flex (OCPU 1, 메모리 6GB)
     → Select shape. 'Out of capacity'로 만들어지지 않으면 AMD의 VM.Standard.E2.1.Micro를 고르세요.
     (둘 다 "Always Free-eligible" 표시가 있는 무료 모양입니다)
   - Security: 그대로 둡니다
   - Networking: Select existing virtual cloud network → 2번에서 만든 VCN과 이름에 public subnet이 들어간 서브넷,
     "Automatically assign public IPv4 address"를 켭니다
   - Add SSH keys: Generate a key pair for me → Save private key (.key 파일이 내려받아집니다 - 잃어버리면 접속할 수 없으니 잘 보관)
   - Storage: 그대로 둡니다 (무료 범위 안)
   - 맨 아래 Create → 상태가 Running이 되면 인스턴스 화면의 Public IP address를 적어 둡니다
4. 포트 열기: 메뉴(≡) → Networking → Virtual cloud networks → 2번에서 만든 VCN → Security 탭
   → Security Lists의 Default Security List → Security rules 탭 → Add Ingress Rules
   - Source Type: CIDR / Source CIDR: 0.0.0.0/0 / IP Protocol: TCP / Destination Port Range: 28471
   - 나머지는 비워 두고 Add Ingress Rules
5. 키 파일 권한 (내 PC의 PowerShell, 처음 한 번 - 안 하면 ssh가 키를 거부합니다).
   키 파일은 C 드라이브(예: C:\Users\내이름\.ssh)에 두세요 - USB나 exFAT 드라이브에서는 권한이 걸리지 않습니다.
   키 파일 이름은 받은 파일 그대로 넣으세요 (예: ssh-key-2026-10-14.key):
   icacls "C:\키경로\ssh-key.key" /inheritance:r /grant:r "$($env:USERNAME):R"
6. 파일 올리기 (PowerShell, coop_server.py가 있는 폴더에서):
   scp -i "C:\키경로\ssh-key.key" coop_server.py ubuntu@서버IP:~/
7. 서버 접속 (PowerShell): ssh -i "C:\키경로\ssh-key.key" ubuntu@서버IP
   처음에는 "Are you sure you want to continue connecting?"에 yes. 이후 명령은 이 창에 입력합니다.
   - PowerShell ISE 말고 일반 PowerShell(또는 터미널) 창을 쓰세요 - ISE에서는 글자가 입력되지 않습니다.
   - 'scp'/'ssh'를 찾을 수 없다고 나오면 전체 경로로 실행합니다
     (예: & "C:\Windows\System32\OpenSSH\ssh.exe" -i ... ubuntu@서버IP).
8. 서버 안 방화벽 열기 (오라클의 Ubuntu는 처음에 막혀 있습니다):
   sudo iptables -I INPUT -p tcp --dport 28471 -j ACCEPT && sudo netfilter-persistent save

구글 클라우드 (미국 리전 e2-micro 무료, 서울 리전은 유료)
1. Compute Engine → VM 인스턴스 → 인스턴스 만들기
   - 리전: us-west1, us-central1, us-east1 중 하나 / 머신 유형: e2-micro
   - 부팅 디스크: 변경 → Ubuntu, 디스크 유형 "표준 영구 디스크" 30GB 이하 (다른 유형은 유료)
   - 만들기 → 외부 IP를 적어 둡니다
2. 포트 열기: VPC 네트워크 → 방화벽 → 방화벽 규칙 만들기
   - 대상: 네트워크의 모든 인스턴스, 소스 IPv4 범위 0.0.0.0/0, TCP 28471 → 만들기
3. VM 목록의 SSH 버튼 → 열린 창 위쪽의 "파일 업로드"(UPLOAD FILE)로 coop_server.py를 올립니다.
   이후 명령은 이 창에 입력합니다.

서버 창에서 (둘 다)
- 켜기: nohup python3 coop_server.py > coop.log 2>&1 &
- 접속 PIN·호스트 PIN 보기: cat coop.log
- 켜져 있는지 보기: pgrep -af coop_server
- 끄기: pkill -f coop_server
- 서버가 다시 시작돼도 자동으로 켜기 (한 번만):
  (crontab -l 2>/dev/null; echo "@reboot cd $HOME && python3 coop_server.py > coop.log 2>&1") | crontab -
- 게임에서: 호스트는 메뉴 → 협력 → 내 세계 열기 (다른 곳의 협력 서버)에 서버 IP와 호스트 PIN,
  친구는 친구의 세계로 가기 → 새 서버 추가에 서버 IP, 포트 28471, 접속 PIN.
새 버전: 파일을 다시 올린 뒤(구글 클라우드는 덮어쓰지 않고 'coop_server_(1).py'처럼 쌓임) 이 한 줄:
pkill -f coop_server; f=$(ls -t coop_server*.py | head -1); [ "$f" = coop_server.py ] || mv -f "$f" coop_server.py; for x in coop_server*.py; do [ "$x" = coop_server.py ] || rm -f -- "$x"; done; nohup python3 coop_server.py > coop.log 2>&1 &


업데이트
--------
새 버전의 압축을 같은 폴더에 덮어쓰면 됩니다. 세이브·설정·게임 폴더 경로는 그대로 남습니다.


문제가 있을 때
--------------
- 게임 폴더가 확인되지 않음: Game.exe와 Data 폴더(또는 Game.rgss3a)가 있는 폴더를 고르세요.
- 'VR NOT SUPPORTED'가 뜸: SteamVR이나 Quest Link를 먼저 켜고, 게임 창을 닫았다가 '실행'을 다시 누르세요.
- VR에서 나온 뒤 다시 들어가기: 버튼이 잠깐 'VR ...'이 되었다가 ENTER VR로 돌아오면 다시 누르세요.
- 대시보드를 열거나 헤드셋을 벗으면 게임이 멈춥니다.
- 컨트롤러 진동은 SteamVR을 쓸 때만 납니다.
- 포트 오류: 런처의 포트 번호를 바꿔 보세요.
- 그래픽 카드가 두 개인 노트북은 게임 창이 뜰 때 화면이 한 번 깜박일 수 있습니다(정상).


이 모드는 비공식 팬 제작물이며 원작 제작자와는 관계가 없습니다.
원작: 寿司勇者トロ  https://x.com/toro_yori_ebi
모드 제작: Allobe  https://www.youtube.com/@Allobe

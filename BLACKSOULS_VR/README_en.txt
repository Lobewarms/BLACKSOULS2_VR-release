BLACK SOULS II VR  (version 2026.10.26-9)
==================================

An unofficial fan mod for playing BLACK SOULS II in first-person VR (PCVR).
- No game data is included. You need your own BLACK SOULS II game folder.
- Your original saves (Save01-16) can be loaded in VR. Their difficulty (0-9, picked in the library) applies too:
  change it in the library, as in the original.
- VR saves and settings go to the saves folder in this folder.


You need
--------
- Windows 10/11 and an up-to-date Chrome or Edge
- A PCVR headset: a SteamVR headset, or Meta Quest (Link / Air Link / Virtual Desktop)
- RPG Maker VX Ace RTP (free; once installed, the launcher finds it by itself)
  On https://www.rpgmakerweb.com/run-time-package, under "RPG Maker VX Ace", press Download Run Time Package,
  unzip it and install it with Setup.exe in the RTP100 folder.


How to start
------------
1. Unzip somewhere outside the game folder.
2. Run BlacksoulsVR.exe. (If "Windows protected your PC" appears: "More info" -> "Run anyway")
3. Pick your BLACK SOULS II folder (the one with Game.exe) with "Browse..." and press "Launch".
4. When the game window opens, put the headset on and press ENTER VR at the bottom of the window.
   With "Enter VR by itself when the game window opens" on, it goes into VR by itself.
5. Keep the launcher open while you play.

Choose the language at the top right of the launcher. The game's own dialogue and names stay as in your copy.


SteamVR
-------
- With SteamVR closed, press "Add to the SteamVR library" to start the game from the SteamVR library.
- To see the desktop inside VR, turn on "Run with SteamVR" and open the SteamVR dashboard with the system button.
- Once added, run the launcher once if you move this folder, and press "Remove from SteamVR" before deleting it.


Controls
--------
The controls are in CONTROLS_en.txt.
In the menu (VR: Y, PC: Tab): save, load, oath, and the turning, combat and display settings.


Combat
------
Enemies attack in real time once you come near.

When an enemy winds up, the area it will hit shows on the floor and fills up; the attack lands the moment it is
full. Get out of it before that.
- Orange: a normal attack. Dodge or guard.
- Purple: a sure hit. The dodge's invincibility does not help: get out of the area or guard.
- Pink (flashing edge, low warning tone): a normal guard does not stop it. Dodge or perfect-guard.
- Crimson: only getting out of the area or a perfect guard works.
- A line: something flying at you. It follows you until it is fired - step aside after it is fired. A purple
  shot keeps following you: block it with the shield.

- Guard: a raised shield takes less damage. Shots are only stopped when they hit the shield.
- Perfect guard: raise the shield just before the hit - no damage, some HP back and, for a while, more attack and
  defence.
- Dodge: you are invincible at the start of the dash (not against purple or crimson attacks).
- Charged blow: up to double damage.
- Break: most enemies can only be broken while charging up (a golden ring at their feet) or guarding. A broken
  enemy is defenceless: a charged blow or a very hard swing then does big damage.
  A red ring at an enemy's feet means a big attack that cannot be broken is coming.
- Groggy: the pale bar under an enemy's HP bar. Weapon hits wear it down; when it runs out the enemy is
  defenceless, as after a Break.
- An enemy shimmering blue strikes back as soon as you hit it. Right after the shimmer starts, a Break works.
- Swinging again and again in quick succession: from the third swing the damage drops (red numbers).
- A gun in the shield slot: the Break button fires it (through enemies). You cannot guard then, but hitting the
  attacker just before its attack lands is a perfect guard, and the enemy's action is cancelled.
- An NPC with a "kill" choice: two weapon hits within 3 seconds are the same as picking that choice.
- Beaten enemies return when you leave the map and come back; resting at a bonfire brings them all back.
- Menu -> Settings -> Combat / display settings: Break rule, Beaten enemies return, Shake when hit, Thrown by heavy blows,
  Enemies pass through walls.


Co-op (in progress)
-------------------
A friend can come into your world to walk and fight with you.
The one who opens a server is the host; those who come in are guests. Guests only need [4].

Which way
- Friends in the same home (same router): [1] -> [2]
- Friends elsewhere (people you trust): [1] -> [2] -> [3]
- With strangers, or when [3] does not work: "Setting up a server elsewhere" below (your IP stays hidden)

[1] Install Python 3 (only whoever opens the server, once)
  1. Go to https://www.python.org/downloads/ - not the big button (Download Python install manager): press the
     "Python 3.x.x" link under it ("Or get the standalone installer for Python 3.x.x") and run the file it downloads.
  2. On the first screen, tick "Add python.exe to PATH" at the bottom, then press "Install Now".
  3. When it says "Setup was successful", press Close.
  - If the server window says "Python was not found" or "Python 3 is needed", Python is not installed or the box in
    step 2 was not ticked. Run the installer again: on the first screen, go on from step 2; if it shows "Modify",
    press Modify -> Next -> tick "Add Python to environment variables" -> Install. Then close and reopen the server window.

[2] Open a server on your PC
  1. Double-click coop_server.cmd in this folder. A black server window opens.
     - If Windows asks whether to run it, press "Run" (for "Windows protected your PC": "More info" -> "Run anyway").
     - When "Windows Security Alert" appears, tick both "Private networks" and "Public networks" and press "Allow access".
       If you closed it or ticked only one: search "firewall" in the Start menu, open "Windows Defender Firewall",
       then on the left "Allow an app or feature through Windows Defender Firewall" -> "Change settings" ->
       tick "Private" and "Public" on every Python row -> "OK".
     - Keep the server window open while you play together. Closing it stops the server.
  2. Note two things in the server window:
     - The join PIN: the 6-digit number on the line marked "give this to your friends"
     - This PC's address: on the line marked "friends on the same router" (e.g. 192.168.0.10), for friends in your home.
  3. Start the game, then menu (VR: Y, PC: Tab) -> Co-op -> "Open my world (co-op server on this PC)".
  4. Give your friends the address, port 28471 and the join PIN.
     - Friends in your home: the address = this PC's address from the server window
     - Friends elsewhere: the address = your public IP ([3], step 2). They can come in only once [3] is done.
  - Change the join PIN and the rules in the game's menu -> Co-op (kicking and banning too).
  - This way your friends see your IP. Play like this only with people you trust.

[3] Friends from elsewhere (opening a port on your router)
  1. Open your router's page: in Command Prompt (search "cmd" in the Start menu) type ipconfig, and put the address
     after "Default Gateway" (e.g. 192.168.0.1) into your browser's address bar.
     The login name and password are usually on a sticker on the router.
  2. Your public IP: look at the outside (WAN / Internet) IP on the router's page.
     - Starting with 10. / 172.16-172.31. / 192.168.: there is another router in front of this one (e.g. your own router
       behind your provider's). Put the gateway address from this router's outside (WAN) information into your browser
       to open the front router's page, and do this step 2 there again. Make the rule of step 3 on both routers (the
       internal IP for the front router's rule is the back router's outside IP).
     - Starting with 100.64-100.127, or the front router's page does not open: your provider shares one public address
       among many homes (CGNAT), so a server cannot be opened from your home (some providers give you a public IP on
       request). Use "Setting up a server elsewhere" below.
     - Any other address: that is your public IP, the address to give friends from elsewhere (e.g. 203.0.113.45).
  3. Add a port forwarding rule: find the "Port Forwarding" menu (also called "Virtual Server" or "NAT") and add a rule:
     - Internal IP: this PC's address from the server window
     - Protocol: TCP
     - External port and internal port: both 28471
     -> Save (apply) it.
  4. If a friend cannot come in by [4] (the game says "Can't reach the server"): check that the rule of step 3
     (internal IP, TCP, 28471) was saved and that the firewall ([2], step 1) allows public networks too. If your
     antivirus has its own firewall, allow Python there too.
  - After a restart this PC's address may change. If it no longer matches the internal IP of step 3, fix the rule.

[4] Going into a friend's world (guests)
  1. Get the address (IP), port and join PIN from the host.
  2. Menu -> Co-op -> "Go to a friend's world" -> "Add a server (IP, port, PIN)".
  3. Enter the IP as 12 digits, three per part; put zeros in front of a part that has fewer than three.
     E.g. 192.168.0.10 -> 192 168 000 010
  4. Enter the port (28471 is already filled in) and the join PIN, and you go in.
     Next time, pick the server from the list in "Go to a friend's world".
  - A guest's game is not saved while away; at the end it goes back to its own world as it was.

Playing together
- Chat and voice: menu -> Co-op -> Chat and voice. Chat is shown as a balloon over the speaker's head (any language typed
  on a PC; the VR keyboard types English, or Korean with its KO/EN key).
  Voice chat uses the microphone only while "Talk and listen" is chosen (the browser asks for it the first time).
- Caution: turning off guests going with the host (guests moving on their own) is still very unstable.
- Caution: with a guest starting a boss fight first on, the game can move on in ways the host did not intend.
- After updating the game, close the server window and open it again (a server elsewhere: "Updating to a new version"
  below).

Community servers (one world everyone shares)
- Joining: menu -> Co-op -> "Community server 1" or "Community server 2".
  For a community server someone else runs: "Add a community server (IP, port, PIN)" with its address, port
  (28472 is already filled in) and join PIN.
- Progress on a community server is saved apart and does not carry over to your own game's saves. To bring it over,
  load it with "Load a community-server save" on the title screen, then save.
- Running one yourself: double-click community_server.cmd. Installing Python ([1]), allowing it through the firewall
  ([2], step 1) and opening the port ([3]) are as for the co-op server, only the port is 28472. Give people the join PIN
  from its window, and come in yourself with "Add a community server" and this PC's address from its window.
  The admin PIN is for changing the rules in the game's co-op menu.
  To run it on a server elsewhere, see "Running a community server" under "Setting up a server elsewhere" below.


Setting up a server elsewhere (a free cloud server)
---------------------------------------------------
A server in a free cloud keeps your IP hidden and stays up while your PC is off. It runs Ubuntu; the port is 28471 (TCP).
Copy each command from here, paste it (right-click or Ctrl+V) and press Enter. Commands go into two places:
- PowerShell: open this folder in File Explorer, type powershell in the address bar at the top and press Enter
- The server window: the window logged in to the server (Oracle: step 7, Google: step 3)
In the commands, replace SERVER_IP with the server's public IP, and "C:\path\ssh-key.key" (quotes included) with your
key file's path: right-click the key file (Windows 10: Shift + right-click) -> "Copy as path", then paste it there.

■ Oracle Cloud (free)
- Oracle may stop a free server that has been nearly idle for 7 days (a co-op server usually is). If it is stopped,
  press Start on the instance page; if it starts by itself ("Starting the server" step 3, a community server's step 5),
  the server comes back too. To keep it from being stopped at all, upgrade the account to Pay As You Go (nothing is
  charged within the free limits).
1. Sign up: the Home Region cannot be changed later - pick the one nearest to you and your friends.
2. The network first: menu (≡) -> Networking -> Virtual cloud networks -> Start VCN Wizard
   -> Create VCN with Internet Connectivity -> Start VCN Wizard -> just a name, Next -> Create
3. Make the server: top-left menu (≡) -> Compute -> Instances -> Create instance
   - Name: any name
   - Image and shape -> Image: Change image -> Ubuntu -> Canonical Ubuntu 22.04 (or 24.04) -> Select image
   - Shape: Change shape -> Virtual machine -> Ampere VM.Standard.A1.Flex (1 OCPU, 6 GB memory) -> Select shape
     If it fails with "Out of capacity", pick AMD VM.Standard.E2.1.Micro instead.
     (both are free shapes marked "Always Free-eligible")
   - Security: leave as it is
   - Networking: Select existing virtual cloud network -> the VCN from step 2 and the subnet with "public subnet" in its
     name, then turn on "Automatically assign public IPv4 address"
   - Add SSH keys: Generate a key pair for me -> Save private key
     (a .key file downloads; without it you cannot get into the server, so do not delete it)
   - Storage: leave as it is (within the free limits)
   - Create at the bottom -> once it is Running, note the Public IP address on the instance page (SERVER_IP)
4. Open the port: menu (≡) -> Networking -> Virtual cloud networks -> the VCN from step 2 -> Security tab
   -> Security Lists: Default Security List -> Security rules tab -> Add Ingress Rules
   - Source Type: CIDR / Source CIDR: 0.0.0.0/0 / IP Protocol: TCP / Destination Port Range: 28471
   - leave the rest empty, then Add Ingress Rules
5. The key file's permissions (PowerShell, once - without this, ssh refuses the key):
   icacls "C:\path\ssh-key.key" /inheritance:r /grant:r "$($env:USERNAME):R"
   Keep the key file on drive C (the Downloads folder is fine). On a USB stick or an exFAT drive this does not work.
6. Upload the file (PowerShell):
   scp -i "C:\path\ssh-key.key" coop_server.py ubuntu@SERVER_IP:~/
   The first time, answer yes to "Are you sure you want to continue connecting".
7. Log in to the server (PowerShell): ssh -i "C:\path\ssh-key.key" ubuntu@SERVER_IP
   This window is now the server window.
   - If "scp" or "ssh" is not found in step 6 or 7, run it by its full path
     (e.g. & "C:\Windows\System32\OpenSSH\ssh.exe" -i "C:\path\ssh-key.key" ubuntu@SERVER_IP / scp is scp.exe).
8. Open the server's own firewall (server window - Oracle's Ubuntu starts closed):
   sudo iptables -I INPUT -p tcp --dport 28471 -j ACCEPT && sudo netfilter-persistent save
9. Go on to "Starting the server" below.

■ Google Cloud (e2-micro free in the US regions)
- A new sign-up gets a $300 credit to use within 90 days. The card you register may show a pending authorization for a
  while (a check, not a charge: it goes away within 1-14 business days, depending on the bank). Nothing is charged
  during the trial, nor when the 90 days end, unless you upgrade yourself. While the credit lasts, paid regions nearer
  to you (e.g. Tokyo asia-northeast1, Seoul asia-northeast3) can be paid with it too.
- When the 90 days are over or the credit runs out, the server stops. To keep it, upgrade to a paid account before then
  ("Upgrade" on the Billing page; on some pages "Activate") - within 30 days after it stops it can still be brought
  back; after that it is deleted. Once upgraded, whatever goes beyond the free limits is charged to the card
  automatically: the e2-micro and a 30 GB standard disk in the US regions stay free, but other regions and the server's
  outbound data beyond 1 GB a month are charged. For long play with several friends, Oracle (outbound data free up to
  10 TB a month) is the better choice.
1. Compute Engine -> VM instances -> Create instance
   - Region: us-west1, us-central1 or us-east1 (for the 90 days only, a region near you works too) / Machine type: e2-micro
   - Boot disk: Change -> Ubuntu, disk type "Standard persistent disk", 30 GB or less (other types are paid)
   - Create -> note its External IP (SERVER_IP)
2. Open the port: VPC network -> Firewall -> Create firewall rule
   - Targets: All instances in the network / Source IPv4 ranges: 0.0.0.0/0 / tick TCP, port 28471 -> Create
3. Press the VM's SSH button. The window that opens is the server window.
   Upload coop_server.py from this folder with "UPLOAD FILE" at the top of that window.
4. Go on to "Starting the server" below.

■ Starting the server (Oracle or Google, in the server window)
1. Start: nohup python3 coop_server.py > coop.log 2>&1 &
2. See the PINs: cat coop.log -> note the join PIN (the line "give this to your friends") and the host PIN
   (the line "only to host from another PC").
3. Start it by itself whenever the server restarts (once):
   (crontab -l 2>/dev/null; echo "@reboot cd $HOME && python3 coop_server.py > coop.log 2>&1") | crontab -
4. In the game (the address is SERVER_IP - not the "friends on the same router" address in coop.log):
   - Host: menu -> Co-op -> "Open my world (co-op server elsewhere)" -> "Add a server (IP, port, PIN)"
     -> SERVER_IP, port 28471, join PIN, host PIN
   - Friends: as in [4], with SERVER_IP, port 28471 and the join PIN
- Closing the server window leaves the server running. To get back in: Oracle's step 7 (ssh), or Google's SSH button.
- Is it running: pgrep -af coop_server (nothing shown: it is off - start it with step 1)
- Stop: pkill -f coop_server
- Nobody gets in: check that it is running, then the port steps again (Oracle 4 and 8, Google 2).

■ Updating to a new version
1. Upload the new coop_server.py again (Oracle: step 6 / Google: UPLOAD FILE).
2. Type this one line in the server window. It stops the server, makes the newest upload coop_server.py and starts it
   again (Google does not overwrite a file of the same name - it keeps 'coop_server_(1).py' and so on):
   pkill -f coop_server; f=$(ls -t coop_server*.py | head -1); [ "$f" = coop_server.py ] || mv -f "$f" coop_server.py; for x in coop_server*.py; do [ "$x" = coop_server.py ] || rm -f -- "$x"; done; nohup python3 coop_server.py > coop.log 2>&1 &

■ Running a community server (port 28472)
1. Do Oracle steps 1-7 or Google steps 1-3 the same way, but open port 28472 (Oracle step 4, Google step 2) and
   upload both coop_server.py and world_server.py (Oracle step 6 is then this line):
   scp -i "C:\path\ssh-key.key" coop_server.py world_server.py ubuntu@SERVER_IP:~/
2. Oracle: instead of step 8, type this line in the server window:
   sudo iptables -I INPUT -p tcp --dport 28472 -j ACCEPT && sudo netfilter-persistent save
3. Start: nohup python3 world_server.py > world.log 2>&1 &
4. See the PINs: cat world.log -> note the join PIN (the line "the PIN players add the server with") and the admin PIN
   (the line "to change the rules in the game").
5. Start it by itself whenever the server restarts (once):
   (crontab -l 2>/dev/null; echo "@reboot cd $HOME && python3 world_server.py > world.log 2>&1") | crontab -
6. In the game: menu -> Co-op -> "Add a community server (IP, port, PIN)" -> SERVER_IP, port 28472, join PIN
- Is it running: pgrep -af world_server / Stop: pkill -f world_server
- New version: upload both files again, then type this one line in the server window:
  pkill -f world_server; for n in coop_server world_server; do f=$(ls -t $n*.py | head -1); [ "$f" = $n.py ] || mv -f "$f" $n.py; for x in $n*.py; do [ "$x" = $n.py ] || rm -f -- "$x"; done; done; nohup python3 world_server.py > world.log 2>&1 &
- The same server can run a co-op server too: then open both ports, 28471 and 28472.


Updating
--------
Unzip the new version over the same folder. Your saves, settings and game folder path are kept.


Troubleshooting
---------------
- The game folder is not accepted: pick the folder with Game.exe and the Data folder (or Game.rgss3a).
- "VR NOT SUPPORTED": start SteamVR or Quest Link first, close the game window and press "Launch" again.
- Going back into VR: after you leave, the button reads "VR ..." for a moment; when it says ENTER VR again, press it.
- The game waits while the dashboard is open or the headset is off.
- Controller vibration only works with SteamVR.
- Port error: change the port number in the launcher.
- Laptops with two graphics chips: the screen may flicker once when the game window opens (normal).


This mod is an unofficial fan work and has nothing to do with the makers of the original game.
Original game: 寿司勇者トロ  https://x.com/toro_yori_ebi
Mod: Allobe  https://www.youtube.com/@Allobe

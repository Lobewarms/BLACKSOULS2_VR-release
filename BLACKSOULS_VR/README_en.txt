BLACK SOULS II VR  (version 2026.10.24-10)
==================================

An unofficial fan mod for playing BLACK SOULS II in first-person VR (PCVR).
- No game data is included. You need your own BLACK SOULS II game folder.
- Your game folder and your original saves are never changed. The original saves (Save01-16) can be loaded in VR.
- The difficulty of an original save (0-9, picked in the library) applies too. Change it in the library, as in the
  original.
- VR saves (autosave + 16 slots) and settings go to the saves folder in this folder.


You need
--------
- Windows 10/11 and an up-to-date Chrome or Edge
- A PCVR headset: a SteamVR headset, or Meta Quest (Link / Air Link / Virtual Desktop)
- (optional) RPG Maker VX Ace RTP: the launcher finds it when it is installed. Without it, some tiles on a few maps
  look empty, and no balloons show (emotes too).


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
- Host: run coop_server.cmd (needs Python 3), then menu -> Co-op -> Open my world (co-op server on this PC).
  Give your friends the join PIN shown in the server window, and the address: for friends on the same router, this PC's
  address shown there; for friends over the internet, your public IP.
  For friends over the internet, forward port 28471 (TCP) on your router to this PC, and when the Windows firewall asks,
  tick "Public networks" too and allow it. If the outside (WAN) IP on your router's page is not your public IP (a shared
  line, two routers), no port can be opened from outside: use a server elsewhere, below. Test from another network
  (a phone's mobile data), not from home.
- Guest: menu -> Co-op -> Go to a friend's world -> Add a server -> IP, port, PIN.
- A server on your own PC shows your IP to your friends and opens a port on your router: play that way only with people you trust.
  With anyone else, use a server elsewhere ("Setting up a server elsewhere" below).
- A server elsewhere: run coop_server.py there, then Open my world (co-op server elsewhere) with its IP and host PIN.
- When you update the game, replace the server's coop_server.py with the new one too and restart it.
- The host changes the server rules and the join PIN in menu -> Co-op.
- Caution: turning off guests going with the host (guests moving on their own) is still very unstable.
- Caution: with a guest starting a boss fight first on, the game can move on in ways the host did not intend.
- A guest's game is not saved while away; at the end it goes back to its own world as it was.
- Chat and voice: menu -> Co-op -> Chat and voice. Chat is shown as a balloon over the speaker's head (any language typed on a PC; the VR keyboard types English, or Korean with its KO/EN key).
  Voice chat uses the microphone only while "Talk and listen" is chosen (the browser asks for it the first time).
- Progress on a community server (menu -> Co-op -> Community server) is saved apart and does not carry over to your own game's saves. To bring it over, load it with "Load a community-server save" on the title screen, then save.
- To run a community server: start community_server.cmd (needs Python 3) and open port 28472 (TCP). Players join with
  menu -> Co-op -> Add a community server: the IP, port 28472 and the PIN shown in the server's window.
  On a server elsewhere, upload world_server.py together with coop_server.py and run python3 world_server.py.


Setting up a server elsewhere (examples)
----------------------------------------
Only coop_server.py goes up. The server runs Ubuntu; the port is 28471 (TCP).
Type ssh, scp and icacls in PowerShell on your own PC; the other commands in the window logged in to the server.

Oracle Cloud (free)
1. Sign up: the Home Region cannot be changed later. If Korea is not listed, pick Japan (Osaka or Tokyo).
2. The network first: menu (≡) -> Networking -> Virtual cloud networks -> Start VCN Wizard
   -> Create VCN with Internet Connectivity -> Start VCN Wizard -> just a name, Next -> Create
3. Make the server: top-left menu (≡) -> Compute -> Instances -> Create instance
   - Name: any name
   - Image and shape -> Image: Change image -> Ubuntu -> Canonical Ubuntu 22.04 (or 24.04) -> Select image
   - Shape: Change shape -> Virtual machine -> Ampere VM.Standard.A1.Flex (1 OCPU, 6 GB memory)
     -> Select shape. If it fails with 'Out of capacity', pick AMD VM.Standard.E2.1.Micro instead.
     (both are free shapes marked "Always Free-eligible")
   - Security: leave as it is
   - Networking: Select existing virtual cloud network -> the VCN from step 2 and the subnet with "public subnet" in its name,
     then turn on "Automatically assign public IPv4 address"
   - Add SSH keys: Generate a key pair for me -> Save private key (a .key file downloads - keep it: without it you cannot log in)
   - Storage: leave as it is (within the free limits)
   - Create at the bottom -> once it is Running, note the Public IP address on the instance page
4. Open the port: menu (≡) -> Networking -> Virtual cloud networks -> the VCN from step 2 -> Security tab
   -> Security Lists: Default Security List -> Security rules tab -> Add Ingress Rules
   - Source Type: CIDR / Source CIDR: 0.0.0.0/0 / IP Protocol: TCP / Destination Port Range: 28471
   - leave the rest empty, then Add Ingress Rules
5. The key file's permissions (PowerShell on your PC, once - without this ssh refuses the key).
   Keep the key file on drive C (e.g. C:\Users\YOU\.ssh) - on a USB stick or an exFAT drive its permissions cannot be set.
   Use the key file's own name as downloaded (e.g. ssh-key-2026-10-14.key):
   icacls "C:\path\ssh-key.key" /inheritance:r /grant:r "$($env:USERNAME):R"
6. Upload (PowerShell, in the folder with coop_server.py):
   scp -i "C:\path\ssh-key.key" coop_server.py ubuntu@SERVER_IP:~/
7. Log in (PowerShell): ssh -i "C:\path\ssh-key.key" ubuntu@SERVER_IP
   The first time, answer yes to "Are you sure you want to continue connecting?". Type the next commands in this window.
   - Use a plain PowerShell (or Terminal) window, not PowerShell ISE - nothing can be typed there.
   - If 'scp' / 'ssh' is not found, run it by its full path
     (e.g. & "C:\Windows\System32\OpenSSH\ssh.exe" -i ... ubuntu@SERVER_IP).
8. Open the server's own firewall (Oracle's Ubuntu starts closed):
   sudo iptables -I INPUT -p tcp --dport 28471 -j ACCEPT && sudo netfilter-persistent save

Google Cloud (e2-micro free in US regions; Seoul is paid)
1. Compute Engine -> VM instances -> Create instance
   - Region: us-west1, us-central1 or us-east1 / Machine type: e2-micro
   - Boot disk: Change -> Ubuntu, disk type "Standard persistent disk", 30 GB or less (other types are paid)
   - Create -> note its External IP
2. Open the port: VPC network -> Firewall -> Create firewall rule
   - Targets: All instances in the network, Source IPv4 ranges 0.0.0.0/0, TCP 28471 -> Create
3. The VM's SSH button -> "UPLOAD FILE" at the top of that window: coop_server.py.
   Type the next commands in this window.

In the server window (either)
- Start: nohup python3 coop_server.py > coop.log 2>&1 &
- See the join PIN and host PIN: cat coop.log
- Is it running: pgrep -af coop_server
- Stop: pkill -f coop_server
- Start by itself whenever the server restarts (once):
  (crontab -l 2>/dev/null; echo "@reboot cd $HOME && python3 coop_server.py > coop.log 2>&1") | crontab -
- In the game: the host uses menu -> Co-op -> Open my world (co-op server elsewhere) with the server IP and host PIN;
  friends use Go to a friend's world -> Add a server with the server IP, port 28471 and join PIN.
New version: upload the file again (Google Cloud does not overwrite - it keeps 'coop_server_(1).py' and so on), then this one line:
pkill -f coop_server; f=$(ls -t coop_server*.py | head -1); [ "$f" = coop_server.py ] || mv -f "$f" coop_server.py; for x in coop_server*.py; do [ "$x" = coop_server.py ] || rm -f -- "$x"; done; nohup python3 coop_server.py > coop.log 2>&1 &


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

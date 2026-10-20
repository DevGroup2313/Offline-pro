THE OFFLINE PROJECT  |  Copyright (c) 2026 Yannie D. Forest. All rights reserved.
NO LICENCE IS GRANTED. No copying, adaptation, redistribution, reverse
engineering or commercial use without the author's written permission.
See LICENCE.txt. Every distributed copy carries a build marker.
--------------------------------------------------------------------------

THE OFFLINE PROJECT FOR IPHONE AND IPAD
=======================================

Build 20261019 (20261019), 2026-10-19. Made by The Forge, 19 October 2026.

THIS PACKAGE IS FOR: iPhone and iPad (one app for both).


TWO WAYS TO PUT THE APP ON YOUR IPHONE OR IPAD
----------------------------------------------
WAY 1, WITH A MAC. If you have a Mac, try this way first. Xcode, Apple's
  own free program, puts the app on the device straight from the project
  in this package. Start with "Open The Offline Project in Xcode.command". See
  Part 1.
WAY 2, WITH A WINDOWS LAPTOP. Sideloadly puts the ready-made app file,
  TheOfflineProject.ipa, on the device. GitHub builds that file for you. See Part 2.

Both ways need the USB cable and your Apple ID. Both put the same app on
the device, with the same identifier. Use the same Apple ID both ways:
then, as far as I know, your work should stay if you change from one
way to the other. Export a backup first, to be safe (YOUR WORK).

If you tried before and it did not install, go to "IF IT DOES NOT
INSTALL" near the end. It gives one cure for each known cause.


READ THIS FIRST
---------------
- Opening a file on the iPhone or iPad installs nothing. the_offline_project.html
  opened from the Files app is only shown as a preview, and tapping
  TheOfflineProject.ipa on the device installs nothing either. The app is put on
  the device from a computer, over the cable.
- Apple lets an app onto an iPhone or iPad only if it is signed with an
  Apple ID. (Apple now also calls the Apple ID an "Apple Account". It is
  the same thing.) Xcode or Sideloadly signs the app with yours while it
  installs it. Which kind of Apple ID you have decides the rest.
    FREE APPLE ID   Apple's own page "Developer account overview"
                    (developer.apple.com/support/compare-memberships)
                    says, at the time of writing:
                    - Up to 3 APPS installed this way on each device.
                      Other apps installed this way on the same device
                      (for example Inkwell, Ingenium or Carpe Diem)
                      count towards those 3. A fourth app is refused.
                    - Each install lasts 7 DAYS. Then the app stops
                      opening until you install it again the same way
                      (a few minutes; your work should stay).
                    - Up to 10 new APP IDENTIFIERS, each kept 7 days.
                      Every new app uses one, and so does every
                      changed identifier.
                    - Up to 3 DEVICES, each kept 7 days.
                    Apple can change these numbers. Please check that
                    page for the current ones.
    PAID ACCOUNT    An Apple Developer Program membership (about 99 US
                    dollars a year; check Apple's current price). Each
                    install lasts a year, and the 3-app limit of a free
                    Apple ID does not apply (as far as I know).
- iOS 16 and later also ask you to switch on Developer Mode, once on
  each device (step 9).
- Apple's rules, and the screens of Xcode and Sideloadly, change from
  time to time. Where a step does not match what you see, follow the
  words on your screen, and note them.


WHAT IS IN THIS PACKAGE
  READ ME FIRST.txt               This guide.
  Open The Offline Project in Xcode.command
                                  Way 1. Checks that Xcode is installed,
                                  opens the project and shows the steps.
  TheOfflineProject.ipa           The ready-made app for Way 2, when it
                                  was added.
  iPhone and iPad project/        The project, and what GitHub needs to
    .github/                      build TheOfflineProject.ipa: its build recipe,
    iphone-ipad/                  and the Xcode project
                                  (TheOfflineProject.xcodeproj) with
                                  the_offline_project.html inside it.
                                  iphone-ipad/README.txt is this guide
                                  again.
  Home Screen app/                The Offline Project ready to be put online,
                                  for the Home Screen web app, which is
                                  on hold (Part 4a).
  GITHUB_WORKFLOW_paste_this.txt  The build recipe again, as a visible file
                                  you can copy from (Part 3, step 29).
  LICENCE.txt


PART 1. WAY 1: WITH A MAC AND XCODE
-----------------------------------
This is the way Carpe Diem for iPhone and iPad is installed. You need a
Mac (a MacBook Pro or a Mac mini), the iPhone or iPad, its cable and
your Apple ID. No GitHub and no Sideloadly.

ONCE, ON THE MAC
1. Install Xcode. On the Mac, open the App Store, search for Xcode and
   press Get. It is free and very large, so the download can take a long
   while. If the App Store says this Mac's macOS is too old for it,
   update macOS first: Apple menu, System Settings, General, Software
   Update. If this Mac cannot update far enough, use Way 2 instead.
2. Open Xcode once and let it finish setting itself up. If it asks which
   platforms to add, choose iOS.
3. Add your Apple ID to Xcode. In the menu bar choose Xcode, then
   Settings, then Accounts (in the newest Xcode it is called Apple
   Accounts). Click the + button at the bottom left, choose Apple ID (or
   Apple Account), and sign in. Your name then shows with
   "(Personal Team)" beside it.

EACH TIME: THE FIRST TIME, EVERY 7 DAYS, AND FOR A NEW VERSION
4. Unzip this package. Double-click "Open The Offline Project in Xcode.command".
   A Terminal window opens. It checks that Xcode is installed, opens the
   project in Xcode, and shows these steps in short.
   If the Mac will not open that file (a message that it cannot be
   checked, or that you do not have permission), open the project
   yourself instead. Open the folder "iPhone and iPad project", then
   "iphone-ipad", and double-click TheOfflineProject.xcodeproj. That is all
   the file does.
   If Xcode asks whether you trust a project that came from the
   internet, choose to open it.
5. Choose your Team. In the column on the left of Xcode, click
   TheOfflineProject at the very top (it has a blue icon). In the middle,
   under TARGETS, click TheOfflineProject. Click the tab "Signing &
   Capabilities". Leave "Automatically manage signing" ticked. Next to
   Team, choose your name with "(Personal Team)".
   Leave the Bundle Identifier exactly as it is:
       com.yannieforest.theofflineproject
   It is what keeps your work from one install to the next.
   If a button "Set Up Signing" shows there instead, click it. In the
   small window, choose your Team, check that the Bundle Identifier box
   holds exactly the identifier above (type it in if the box is empty),
   and click Set Up.
   Give Xcode a moment to prepare the signing. If a red message shows
   under Signing, see IF IT DOES NOT INSTALL, H.
6. Connect the iPhone or iPad to the Mac with its cable. Unlock it. If
   it asks whether to trust this computer, tap Trust and type its
   passcode.
7. At the top of the Xcode window, in the middle, click the device name
   shown after TheOfflineProject (at first it may name a simulated iPhone,
   or say Any iOS Device). Choose your iPhone or iPad from the list.
   - Not in the list? Choose Manage Devices in that same list. In the
     window that opens (in the newest Xcode it is called Device Hub),
     click your iPhone or iPad and follow what it says. Click Pair if
     that button shows, and tap Trust on the device if it asks.
   - A Get button beside Any iOS Device means Xcode still needs its iOS
     part. Click Get and wait until it has finished.
   The first time, Xcode spends a few minutes getting the device ready.
   Wait until it has finished.
8. Press Run: the triangle at the top left of the window (or press
   Command + R). Xcode builds the app and puts it on the device. The
   first time, the Mac may ask for its own password so that Xcode can
   sign the app: type it and choose Always Allow. If a Register button
   shows under Signing (step 5), click it, then press Run again.
   Yellow warnings in Xcode do no harm; only a red message stops the app.
   The first time, Xcode will most likely stop once or twice before the
   app opens. That is expected:
   - If Xcode says the device needs Developer Mode, do step 9, then
     press Run again.
   - If Xcode then says it could not open the app, the app is on the
     device but not trusted yet: do step 10, then step 11.

THE FIRST TIME ONLY, ON THE IPHONE OR IPAD
9.  Developer Mode (iOS 16 and later). Open Settings, then Privacy &
    Security, and scroll down to Developer Mode. Switch it on. The
    device warns you and asks to restart: tap Restart. After the
    restart, unlock it. It asks once more: tap Enable and type your
    passcode. These are the steps on Apple's page "Enabling Developer
    Mode on a device". Apple also says the Developer Mode entry shows
    in Settings only once the device has been paired with a Mac, which
    Xcode does at steps 7 and 8. So do those first.
    In Way 1, once Developer Mode is on, press Run in Xcode again
    (step 8).
10. Trust your Apple ID. Open Settings, then General, then VPN & Device
    Management. Under Developer App, tap your Apple ID (your email
    address), then Trust, and confirm. Be online (Wi-Fi) while you do
    this.
    - No Developer App there? Then the app is not on the device yet.
      Press Run in Xcode once more first (in Way 2, do step 19
      instead). As far as I know, the entry appears once the app is
      on the device.
    - The button may say Allow & Restart instead (on iOS 18 and later,
      as far as I know). Tap it. The device then restarts: unlock it,
      follow what the screen says, and open the app.
11. In Xcode press Run again, or open The Offline Project from the Home Screen.

EVERY 7 DAYS (FREE APPLE ID)
12. When the app stops opening (or before, if you like), do steps 4 and
    6 to 8 again, with the same package or a newer one. Xcode remembers
    your Team in a package it has opened before; a newly unzipped
    package needs step 5 too. The app installs over the old copy, and
    your work should stay, because the identifier (step 5) does not
    change. Until you have seen this happen on your own device, export a
    backup from The Offline Project first (YOUR WORK, below).


PART 2. WAY 2: WITH A WINDOWS LAPTOP AND SIDELOADLY
---------------------------------------------------
This is the way Inkwell and Ingenium are installed. Sideloadly is also
made for the Mac, but on a Mac, Way 1 is simpler.

THE APP FILE, TheOfflineProject.ipa
13. If TheOfflineProject.ipa is in this folder, beside this guide, it is the app
    GitHub built from this same project. Go to step 16.
14. If the app has already been built on GitHub: on your computer, sign
    in at github.com (a private repository shows its files only to you)
    and open the repository's "Releases" page, then the release
    "The Offline Project for iPhone and iPad". Under "Assets", click
    TheOfflineProject.ipa to download it. The release notes say "build" and a
    number: if it is 20261019, it is this version. Go to step 16.
15. Otherwise, have GitHub build it once (Part 3), then come back here.

ONCE, ON THE WINDOWS LAPTOP
16. Install Sideloadly from its own site, sideloadly.io.
17. Sideloadly needs Apple's iTunes and iCloud, in the versions from
    Apple's website. Its site says: "Sideloadly requires the web version
    of iTunes & iCloud on Windows. If you have the Microsoft Store
    versions, uninstall them first." Use the download links on
    sideloadly.io, then restart the laptop.

INSTALL
18. Connect the iPhone or iPad with its cable. Unlock it. If it asks
    whether to trust this computer, tap Trust and type its passcode.
19. Open Sideloadly. Drag TheOfflineProject.ipa into its window. Choose the iPhone
    or iPad in its device list. Type your Apple ID (your email address)
    and press Start. Type your Apple ID password, and the code Apple
    sends you, when Sideloadly asks for them.
    Leave Sideloadly's advanced options as they are. Above all, do not
    let it change the app's identifier, which is
        com.yannieforest.theofflineproject
    A changed identifier makes a second, empty app instead of updating
    yours, and it uses up one of the 10 new identifiers (READ THIS
    FIRST).
20. The first time only, on the iPhone or iPad: step 9 (Developer Mode)
    and step 10 (Trust). As far as I know, the Developer Mode entry
    shows in Settings once Sideloadly has put the app on the device.
21. Open The Offline Project from the Home Screen.

EVERY 7 DAYS (FREE APPLE ID), AND NEW VERSIONS
22. When the app stops opening (or before, if you like), repeat steps 18
    and 19 with the same TheOfflineProject.ipa or a newer one. It installs over
    the old copy, and your work should stay. Until you have seen this
    happen on your own device, export a backup first (YOUR WORK, below).
23. A new version: download the newer TheOfflineProject.ipa from the same Releases
    page and install it the same way.
24. Sideloadly's site says it can also re-sign your apps by itself
    before they expire, from its own settings. I have not tried this
    with The Offline Project. AltStore (altstore.io) is another free way that
    renews by itself. It may install the app under a changed identifier,
    and then its copy starts empty: export a backup first (YOUR WORK)
    and read it back in the new copy.


PART 3. HAVE GITHUB BUILD TheOfflineProject.ipa (FOR WAY 2)
-----------------------------------------------------------
GitHub builds the app on one of its own Mac computers, so your Windows
laptop needs neither a Mac nor Xcode. Way 1 does not need this part.

25. Choose the repository. The project can sit beside this app's Fire
    tablet project, in the same repository, in its own folder named
    iphone-ipad (the way Ingenium's repository holds both). Or make a new
    one: sign in at github.com, top right "+", "New repository", a name
    such as the-offline-project-ios, Private, then "Create repository".
26. Unzip this package on your computer and open the folder
    "iPhone and iPad project". It holds two folders, .github and
    iphone-ipad. Make hidden files visible, so that .github can be seen:
      Windows: File Explorer, View, Show, Hidden items.
      Mac: in Finder press Command + Shift + full stop.
27. On the repository's main page click "Add file", then "Upload files"
    (on a new, empty repository: "uploading an existing file"). Select
    BOTH folders, .github and iphone-ipad, and drag them onto the page.
    Wait until every file is listed, then press "Commit changes". In a
    repository that already has a .github folder (for example the Fire
    tablet's recipe), this only adds build-ipa.yml beside it.
28. Check the repository's main page: it must show the folder
    iphone-ipad, and .github/workflows must hold build-ipa.yml.
29. If build-ipa.yml is missing: "Add file", "Create new file"; as the
    name type exactly
        .github/workflows/build-ipa.yml
    open GITHUB_WORKFLOW_paste_this.txt from this package, copy ALL of
    its text into the big box, and press "Commit changes".
30. Open the "Actions" tab. "Build The Offline Project for iPhone and iPad" starts
    by itself (if GitHub asks you to enable Actions, enable them; if no
    run starts, click its name on the left, then "Run workflow"). It
    takes a few minutes. A green tick means TheOfflineProject.ipa was built and put
    on the Releases page.
31. On the repository's main page click "Releases", then "The Offline Project
    for iPhone and iPad". TheOfflineProject.ipa is under "Assets". Go to Part 2,
    step 16.
32. Optional check: Actions, "Build The Offline Project for iPhone and iPad",
    "Run workflow", tick "Also open the app in the iPhone simulator",
    then the green "Run workflow". GitHub then also opens the app in
    Apple's iPhone simulator and checks that its page loads, keeps what
    it stores and finds the file saver. It can take half an hour, and
    the result is added to the release notes.
33. Cost: on a private repository GitHub counts each minute on its Mac
    computers as ten minutes of your monthly allowance (as far as I
    know). That is why the build runs only when something in iphone-ipad
    changes, and the simulator check only when you ask for it. Please
    check GitHub's current figures on its billing pages.
34. A new version later: make the new iPhone and iPad package in The
    Forge and upload BOTH of its folders again, .github and iphone-ipad,
    the same way (steps 26 and 27). GitHub replaces the files and builds
    again by itself.


PART 4. OTHER WAYS
------------------
4a. HOME SCREEN WEB APP: ON HOLD
    Safari can add an app to the Home Screen only from a WEB ADDRESS,
    never from a file. The folder "Home Screen app" is The Offline Project
    ready to be put online, but that needs a hosting account and a
    public web address. There is none for now, so this way is on hold:
    use Way 1 or Way 2. The folder stays in the package in case that
    changes.

4b. TROLLSTORE (free and permanent, but only on certain older iOS versions)
    See github.com/opa334/TrollStore for the versions it supports. On those,
    copy TheOfflineProject.ipa to the device and open it with TrollStore.


YOUR WORK
---------
- The app keeps your work on the device, inside the app. To move work in
  or out, use the app's own backup (in The Forge: Settings, Backup,
  "Export everything", and "Read a backup back" to bring it in).
- Saving a file opens Apple's share sheet: choose "Save to Files".
- NEVER delete the app without exporting a backup first: deleting the app
  deletes its storage.
- The first time something asks for the microphone, iOS asks whether
  The Offline Project may use it. Choose Allow. If it was refused: Settings,
  The Offline Project, Microphone.
- The first time Paste in the app's own menu brings in something you
  copied in another app, iOS 16 and later ask whether The Offline Project
  may paste from it. That question is Apple's own. Choose Allow Paste.
  To change the answer later: Settings, The Offline Project, Paste from
  Other Apps.


IF IT DOES NOT INSTALL
----------------------
Find the line that matches what you see. Each has its cure. The limits
are Apple's, from its page "Developer account overview", at the time of
writing; Apple can change them. A message quoted word for word below is
quoted from Sideloadly's own FAQ (sideloadly.io/faq). Xcode says the
same things in its own words.

  A  Too many apps on the device      H  A red message in Xcode
  B  Too many new identifiers         I  The Mac will not open the
  C  Developer Mode                      .command file
  D  Not trusted                      J  Sideloadly asks for a code
  E  The 7 days are up                K  Too many devices
  F  Sideloadly, iTunes and iCloud    L  The device's iOS is too old
  G  The computer does not see the    M  A copy is already there
     device                           N  Installing apps is not allowed

A. TOO MANY APPS. Xcode or Sideloadly shows a message about the maximum
   number of apps. Sideloadly's FAQ gives its words as: "This device has
   reached the maximum number of installed apps using a free developer
   profile".
   Why: a free Apple ID can keep about 3 apps installed this way on one
   device at the same time (Apple says up to 3). If three other apps
   (for example Inkwell, Ingenium or Carpe Diem) are already installed
   this way on that device, The Offline Project would be the fourth.
   Cure:
   1. Choose the app you need least on that device, or the oldest one
      you installed this way.
   2. Open it and export a backup of its work. Deleting an app deletes
      its work.
      If it no longer opens (its 7 days are up), first install it again
      the way it was installed, from its own package and with the same
      Apple ID (as in E). As far as I know, putting an app over its own
      older copy does not take a new place. Then open it and export its
      backup. If that cannot be done, choose another app, one that
      still opens.
   3. On the Home Screen, touch and hold its icon, tap Remove App, then
      Delete App.
   4. Install The Offline Project again (Way 1, step 8, or Way 2, step 19).
   As far as I know, the place is free again straight away. A paid
   Apple Developer account removes this limit.

B. TOO MANY NEW IDENTIFIERS. A message about the maximum number of App
   IDs. Sideloadly's FAQ gives it as: "Your maximum App ID limit has
   been reached. You may create up to 10 App IDs every 7 days."
   Why: a free Apple ID can register about 10 new app identifiers, and
   each one is kept for 7 days. Every new app uses one, and so does
   every identifier a tool changes.
   Cure: wait. Within 7 days the oldest ones lapse; then try again. In
   the meantime, never let a tool change an identifier (Way 1, step 5;
   Way 2, step 19). As far as I know, installing the same app again,
   with the same identifier and the same Apple ID, does not use up a
   new one. Sideloadly's FAQ also suggests another Apple ID. As far as
   I know, that would need a new identifier, and the app would start
   empty, so waiting is the better cure.

C. DEVELOPER MODE. Xcode or Sideloadly says Developer Mode is needed or
   is off, or the app will not open and the device mentions Developer
   Mode.
   Cure: step 9, then press Run in Xcode again (Way 1) or open the app
   (Way 2). If there is no Developer Mode entry in Settings: on a Mac,
   connect the device and choose it in Xcode (step 7), then look again.
   On Windows, as far as I know, the entry shows once Sideloadly has
   put the app on the device (step 19). A device on iOS 15 has no
   Developer Mode and needs none.

D. NOT TRUSTED. Tapping the app shows a message that its developer is
   not trusted on this device. Sideloadly's FAQ calls it "Untrusted
   Developer".
   Cure: tap Cancel, then do step 10: Settings, General, VPN & Device
   Management, your Apple ID under Developer App, Trust. Be online while
   you do it. Then open the app again.
   If it shows Not Verified instead, connect to the internet and tap
   Verify App. Apple's page on apps from a company says so; as far as I
   know it is the same here.

E. THE 7 DAYS ARE UP. The app opened before, but now it will not open,
   or it closes at once.
   Cure: install it again the same way: Way 1, step 12, or Way 2, step
   22. Your work should stay; export a backup first, to be safe.

F. SIDELOADLY, ON WINDOWS, DOES NOT SEE THE DEVICE, OR MENTIONS iTunes
   OR iCloud.
   Why: Sideloadly needs Apple's own iTunes and iCloud from Apple's
   website, not the versions from the Microsoft Store (step 17).
   Cure:
   1. Windows Settings, Apps: uninstall iTunes and iCloud if they came
      from the Microsoft Store.
   2. Install them again from the links on sideloadly.io.
   3. Restart the laptop.
   4. Open iTunes with the device connected, and tap Trust on the
      device if it asks (Sideloadly's FAQ advises this). Then open
      Sideloadly and try again.

G. THE COMPUTER DOES NOT SEE THE DEVICE (either way). Try these one at a
   time:
   1. Use the cable that came with the device, or one you know carries
      data. Some cables only charge.
   2. Plug it straight into the computer, not into a hub or a keyboard.
   3. Unlock the device and leave it on the Home Screen.
   4. When it asks whether to trust this computer, tap Trust and type
      the passcode.
   5. If you tapped Don't Trust by mistake, unplug the cable and plug it
      in again. Apple's page "About the 'Trust This Computer' alert
      message" says the question comes back each time you connect to a
      computer you have not trusted. If it still does not come back,
      the same page gives a reset: Settings, General, Transfer or Reset
      iPhone (or iPad), Reset, Reset Location & Privacy. As far as I
      know this deletes nothing, but apps will ask again for things
      such as the microphone.
   6. Restart the device and the computer, then try again.

H. XCODE SHOWS A RED MESSAGE UNDER SIGNING (step 5).
   - No Team to choose: add your Apple ID (step 3), then choose the Team.
   - A Register button, or a message that the device is not registered:
     click Register, then press Run again (step 8).
   - A message that the identifier is not available, or cannot be
     registered: as far as I know, another Apple ID already holds it.
     Sign in to Xcode with the Apple ID that installed The Offline Project
     before (Xcode, Settings, Accounts or Apple Accounts). Only if that
     cannot be done: export a backup, add a few letters to the end of
     the Bundle Identifier (for example .home), and press Run. That
     makes a new, empty app: read your backup back into it.
   - A message about the number of apps or App IDs: A or B above.
   - A message that Xcode does not support the device's iOS version, or
     cannot get the device ready: update Xcode from the App Store (and
     macOS, if the App Store asks for it), then try again.

I. THE MAC WILL NOT OPEN "Open The Offline Project in Xcode.command". Open the
   project yourself, as step 4 says. Nothing else is needed.

J. SIDELOADLY ASKS FOR A CODE. That is your Apple ID's two-factor
   check. Type the code Apple sends to your other devices.

K. TOO MANY DEVICES. A free Apple ID can be used with up to 3 devices
   in 7 days (Apple's page). An iPhone and an iPad make 2. If this Apple
   ID was used with other devices this week, wait a few days.

L. THE DEVICE'S iOS IS TOO OLD. A message that the app needs a newer
   version of iOS.
   Why: The Offline Project needs iOS 15 (on an iPad, iPadOS 15) or later.
   Cure: Settings, General, Software Update. Settings, General, About
   shows the version the device has now. A device that cannot reach
   iOS 15 cannot run the app.

M. A COPY IS ALREADY THERE. The Offline Project is already on the device from
   an earlier install, and the new install stops with a message that it
   cannot be installed or updated.
   Why (as far as I know): the copy on the device was signed with
   another Apple ID, and iOS will not put one over the other.
   Cure: install with the Apple ID that installed the first copy. Only
   if that cannot be done: open the old copy, export a backup, delete
   it (Remove App, then Delete App), install again, and read the backup
   back in.

N. INSTALLING APPS IS NOT ALLOWED. A message that installing is not
   allowed or is prohibited. Sideloadly's FAQ names it
   "Installation failed: 0 InstallProhibited".
   Why: Screen Time on the device does not allow new apps.
   Cure: the path Sideloadly's FAQ gives is Settings, Screen Time,
   Content & Privacy Restrictions, iTunes & App Store Purchases,
   Installing Apps, Allow. On a newer iOS the names may differ a
   little. You can set it back afterwards.

STILL NOT INSTALLED?
First check that the date and time are right on both the device and
the computer: Sideloadly's FAQ links some signing messages to a wrong
date. Then please write down the exact message, word for word, or take
a picture of the screen:
  - on the iPhone or iPad: press the side button and the volume up
    button together (with a Home button: the Home button and the side
    or top button);
  - on a Mac: Command + Shift + 3;
  - on Windows: the Windows key and Print Screen together.
Note also which way you used (Way 1 with Xcode, or Way 2 with
Sideloadly), the step you were on, and which other apps are installed
this way on that device. With these, the cause can be found.


IF GITHUB'S BUILD FAILS (PART 3)
--------------------------------
- No run in the Actions tab: build-ipa.yml is missing from
  .github/workflows at the top of the repository. Do step 29.
- A red cross at "Find the Xcode project": the folder iphone-ipad is not
  at the top of the repository. Upload it again (step 27).
- A red cross within seconds, with no steps listed: GitHub refused to start
  the build, which is about the account (used-up free minutes, or a
  spending limit or payment problem at github.com/settings/billing). Open
  the run: GitHub names the reason near the top.
- A red cross at "Build the app": open the step "If the build failed, show
  why"; the whole log is kept with the run as "ios-build-log".
- A red cross at "Put the IPA on the Releases page": first click "Re-run
  failed jobs". GitHub's upload service sometimes fails (for example
  "HTTP 500"), and the recipe already tries four times. Only if the
  message says 403 or "Resource not accessible by integration": in the
  repository, Settings, Actions, General, Workflow permissions: choose
  "Read and write permissions", Save, then "Re-run all jobs".
  TheOfflineProject.ipa is also kept with the run itself, under "Artifacts".
- A red cross at "Open the app in the iPhone simulator and check its
  page" (only when you asked for that check): the lines under "what the
  app said" name the cause. TheOfflineProject.ipa was already published before the
  check ran.


WHAT WAS AND WAS NOT CHECKED
----------------------------
- Each GitHub build checks that the app inside TheOfflineProject.ipa is byte for
  byte the file the_offline_project.html that was uploaded. Opening the app in Apple's
  iPhone simulator happens only when you ask for it (step 32); its
  result is then added to the release notes.
- Way 1 follows Carpe Diem's iPhone and iPad project, which is installed
  with Xcode and a free Apple ID. This project matches it in every
  setting that signing depends on: automatic signing, no Team chosen in
  advance (Xcode asks you), nothing that needs a paid account, iOS 15
  and later, and an app icon of 1024 by 1024.
- Way 2 follows the way Inkwell and Ingenium are installed, and
  Sideloadly's published method.
- The limits, the Developer Mode steps, the Xcode screens and the Trust
  reset come from Apple's own pages, read on 9 October 2026 and again
  on 10 October: "Developer account overview", "Enabling Developer
  Mode on a device", "Running your app on simulated or physical
  devices" and "About the 'Trust This Computer' alert message". Allow &
  Restart and Verify App come from Apple's page "Install custom
  enterprise apps on iOS, iPadOS, and visionOS" (10 October), which is
  about apps from a company. The messages quoted word for word, and the
  advice on iTunes and iCloud, come from Sideloadly's site and its FAQ,
  read on the same days.
- These steps were written without an iPhone, an iPad, a Mac or
  Sideloadly to hand. Where your screen differs, follow your screen,
  and note what it says.

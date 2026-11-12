# Scorecard setup (Anersi's clicks)

One step at a time. Each step says what you should see when it worked. Nothing here costs money (Supabase free tier and your existing Vercel plan are enough).

## Phase 1: the board on the TV (release 1)

### Step 1. Put the app on `main`
Vercel builds the `main` branch, and right now `main` holds only a one-line README: the app lives on pull request #1.
1. Open https://github.com/anersi-fex/tkg-scorecard/pull/1 (signed in as anersi-fex).
2. Tap **Ready for review**, then **Merge pull request**, then **Confirm merge**.
3. You should see "Pull request successfully merged and closed".

### Step 2. Make a new Supabase project
1. Go to supabase.com and sign in (same account as Sales Coach).
2. Tap **New project**. Name: `scorecard`. Region: **East US (Ohio)**. Click **Generate a password**, save it in your password manager, then **Create new project**.
3. Wait about 2 minutes until the project dashboard shows.

### Step 3. Set up the database
1. Open https://github.com/anersi-fex/tkg-scorecard/blob/main/supabase/migrations/0001_init.sql, tap the **Raw** button, select all, copy.
2. In Supabase, open **SQL Editor** (left menu), tap **New query**, paste, tap **Run**.
3. You should see **Success. No rows returned**.
4. Do the same with `0002_carrier.sql` (the carrier a sale was written with; added 2026-10-27). Done already on the live project if Log a sale shows the carrier chips.
5. Do the same with `0003_pc.sql` (P&C next to life, added 2026-11-04: a sale's kind and who is P&C licensed). Then, on the Team page, tap Edit on yourself, Moe and Maira and switch on **P&C licensed**: Log a sale then offers Life or P&C for the three of you.
6. Do the same with `0004_pc_goals.sql` (P&C goals, added 2026-11-04). Then Settings > **P&C goal** takes the team's P&C goal for the month, and Team > Edit takes each P&C licensed person's own.
7. Do the same with `0005_lineage.sql` (the Lineage Financial update, added 2026-11-12: everyone's own sign-in, uplines and teams, the office group, admins, join links, approvals). Run it before that update is merged: the app that is live keeps working with it in, and running it twice is safe. It makes your row (the one named exactly Anersi Koka) the owner and Jack Gariglio's an admin, the first time only. Done: Claude ran this one for you on 2026-11-12 at your yes, so there is nothing to paste.
8. Once the Lineage update is live the app is life insurance only: the P&C switches and goals of steps 5 and 6 show only after you turn on Settings > **Other lines of business** > **P&C board** (the last row, yours alone), and Team is called **People**, with a pencil on each person where Edit was.
9. Do the same with `0006_crm.sql` (the CRM update, added 2026-11-12 evening: each policy's details and client, its status and history, managers, uplines that wait to be confirmed). Run it before that update is merged: the app that is live keeps working with it in, it only adds (nothing is removed), and running it twice is safe. The first time only, it makes everyone who has someone under them a **Manager**. Then run `select name, role from agents where role <> 'member';` in a new query: it should list you as owner, Jack as admin and your team leaders as manager. A miss is fixed after the update on **People** > the pencil > the role. Not run yet on the live project: Claude asks for your yes first, then runs it for you or sends you this step.

### Step 4. Copy two values
1. **Project Settings** (gear) > **Data API**: copy the **Project URL** (it looks like `https://abcd.supabase.co`, nothing after `.co`).
2. **Project Settings** > **API Keys**: copy the **secret** key (starts with `sb_secret_`; on older screens it is the `service_role` key). Keep it private.

### Step 5. Put the app on Vercel
1. Go to vercel.com > **Add New** > **Project** > import `anersi-fex/tkg-scorecard`.
2. Before **Deploy**, open **Environment Variables** and add (names exactly as written):

| Name | Value |
|---|---|
| `SUPABASE_URL` | the Project URL from step 4 |
| `SUPABASE_SERVICE_ROLE_KEY` | the secret key from step 4 |
| `OWNER_PASSWORD` | a new strong password just for you (save it in your password manager) |
| `TEAM_PASSWORD` | a simpler password the whole team and the TV use (they can log sales, not change goals) |

3. Tap **Deploy**. When it is done you get an address like `tkg-scorecard-xxxx.vercel.app`.

### Step 6. Tell the app its address (for link previews)
1. In Vercel, **Settings** > **Environment Variables** > **Add** `APP_URL` = `https://` + the address from step 5 (no slash at the end).
2. **Deployments** > the top one > **…** > **Redeploy**. (Desk links already use the address you are on; this is for link previews in texts.)

### Step 7. Your team and your goal
1. Open the address on your phone, sign in with the **owner** password.
2. Tap **Team** (called **People** once the Lineage update is live) and add each person (first and last name). All seven, you included. With the Lineage update you can send one join link instead and people add themselves: see Getting everyone on, below.
3. Tap your initials (top right) > **Settings** > type the month's team goal in dollars of annual premium > **Save**.
4. Tap **Log a sale**, log one real sale. You should see "Logged" with a check mark.

### Step 8. The TV (Mac mini)
1. On the Mac mini, open Safari or Chrome and go to the address + `/board` (for example `https://tkg-scorecard-xxxx.vercel.app/board`).
2. Sign in with the **team** password. The board opens dark. It stays signed in for 180 days.
3. Full screen: press **Control+Command+F** (the Mac's own full screen, which stays on when the page reloads itself after an update; the page's **F** key also works, but drops after a reload). Light or dark, the colorway, P&C's color, and which screens it shows (Rotate: Life for a minute, then P&C and Agency total for 15 seconds each, once the month has a P&C sale; or one screen kept on) are set on your phone under Settings (TV look, Colorway, P&C color, TV screens); the TV follows within 5 seconds. Once the Lineage update is live, Rotate is the Leaderboard for 40 seconds (the office group on top), then Scoreboard, Production and Teams for 20 seconds each (a screen with nothing to show is skipped), and P&C's color and screens are there only while the P&C board is on.
4. System Settings > **Lock Screen**: set "Turn display off" to **Never** while the board is up. The page also asks the Mac to keep the screen awake.
5. Plug the HDMI transmitter into the Mac mini, the receiver into the TV. The board refreshes itself every 5 seconds; a new sale gets confetti.
6. Sound: the board plays the sale sound you pick on your phone under Settings > Sale sound. Browsers hold sound back until someone clicks the page, so once: in **Safari**, Safari > Settings > Websites > **Auto-Play**, find the board's address and pick **Allow All Auto-Play** (it then plays after every reload too); in **Chrome**, click the board once after it opens. While a browser holds the sound back, the board's footer says "Click or press a key once for sound".

### Step 9. Everyone's phone
Once the Lineage update is live, do this the new way: each person gets their own sign-in from one join link, and a guide puts the app on their phone (Getting everyone on, below). Until then:
1. Each person opens the address in Safari, signs in with the **team** password.
2. **Share** button > **Add to Home Screen** > **Add**. The icon is the podium.
3. They log their own sales from **Log a sale** (the app remembers who they picked last time).

That is release 1. Send Claude a photo of the TV: that is the proof.

## Getting everyone on (Lineage Financial, added 2026-11-12)

Live since 2026-11-12.

Everyone gets their own sign-in: their cell number and a password they pick. No text message, no email. The two passwords you already have keep working, so the TV and the phones stay signed in.

### Step 1. Send the join link
1. Sign in with the **owner** password and tap **People** (the last tab).
2. At the top is **Join link**: "Send this to everyone. They sign up themselves." Tap **Copy** (or **Share**) and put it in the agency's group chat.
3. For one leader's team only: tap **Link for one team, or a new link**, pick the leader, and send that link instead. Whoever uses it lands on that leader's team.
4. If a link ever gets out: **Make a new link**. Every link sent before stops working.

### What a new person sees
1. They tap the link. One card: **Join Lineage Financial on Scorecard**.
2. They type their first and last name and their cell number, pick their upline from the list (**I'm not sure** is fine: you or an admin put them on the right team later), switch on **I work in the office** if they do, and pick a password (8 characters or more). Then **Join**.
3. They are signed in, and the next screen is the install guide (below), which puts Scorecard on their phone.
4. Someone who is already on the board sees **Already on the board? Tap your name.** under the name box, with the names of the people on the board who have no sign-in yet. They tap their own name: they get their own row, with the sales already on it, and nobody ends up on the board twice. (Typing the name the way the board has it does the same; typing it some other way makes a second person.) Someone who was taken off the board is told **Ask an admin to put you back on the board.**
5. After the CRM update: an upline picked from the list waits until that upline, a manager above them or an admin taps **Confirm** on People (or **Not on my team**). Someone who came in on a leader's team link is on that team at once.
6. From then on they sign in with that cell number and password. They log their own sales, and can take one back for 15 minutes.

### Step 2. Jack's admin sign-in
The database step makes Jack Gariglio an admin. An admin's sign-in never comes from the join link: you send it.
1. **People** > the pencil on **Jack Gariglio**. Under his name it should say **Admin**. If it does not, tap **Make admin** first.
2. **Send a sign-in link** > **Make their sign-in link**, then **Copy** or **Share**, and text it to Jack only. It works once, for 7 days, and it is shown once (making another turns this one off).
3. Jack opens it, types his cell number and picks a password. He is in as an admin.

What Jack can do: goals, people, any sale of this month, the board and TV settings, the join links. What waits for your yes (your initials > **Approvals**, with a count on your initials): making or removing an admin, and changing a sale of a past month. What he never sees: the passwords, the Shortcut card, the P&C switch.

The same pencil works on your own name if you want to sign in with your own number. The owner password keeps working either way.

### Step 3. The office group, uplines, goals
1. **People** > the pencil on a person: **Upline** (whose team they are on), **In the office** (the office group is at the top of the boards), and their goal.
2. People can set both themselves as they join, and the office switch later under their initials > **Your profile**.
3. Forgot a password: the pencil on that person > **Reset sign-in** > **Make a reset link**, and send it to them. It works once.
4. Someone leaves: the pencil on that person > **Take off the board**. Their sales stay in the history, they are signed out on every device, and any one-time link not used yet stops working (a sign-in or reset link made for them, and any they made for someone else; the join link is not touched). To bring them back: **Put back**, in the **Off the board** list on People. They sign in again with the same cell number and password.
5. If you take admin away from someone (the pencil > **Remove admin**), the sign-in and reset links that admin made and nobody has used yet stop working. Make new ones for those people.

### The install guide
Everyone lands on it right after joining; later it is under their initials > **Put Scorecard on your phone**. It sees which phone and browser they are on, says how many taps it takes, and shows one picture per tap. On an iPhone in Safari: the Share button (a square with an arrow pointing up; if it is not there, the three dots first), **Add to Home Screen**, **Add**. Try it once on your own iPhone and tell Claude if a word on the screen does not match: it was written without a phone in hand.

### What the two shared passwords are for now
- **Owner password**: still signs you in as the owner, anywhere. Once anyone has their own sign-in, the sign-in screen opens asking for a cell number: tap **Use the team password** under it, and type the owner password in that box (it takes both passwords).
- **Team password**: the TV, and a phone that has not joined yet. It can still log sales, as before. Once people have their own sign-ins: **Settings** > **Sign-ins** > switch off **The shared team password can log sales**. Then the team password only looks (the TV keeps working) and people log with their own sign-in.
- After the CRM update (step 3, item 9): the team password only shows the boards (Home, Scoreboard, People's names, the TV) and the switch above is gone. Log a sale and Policies ask for a person's own sign-in.

## Phase 2: desk tags and a Shortcut (optional, after release 1 works)

### Option A, no Shortcut: a tag that opens Log a sale
1. On your phone, **Team** > a person > **Edit** > **Copy** their desk link. (Once the Lineage update is live: **People** > the pencil on a person > **Desk link** > **Copy**.)
2. Write that link to an NFC tag with any NFC writer app (NFC Tools is fine). When a phone touches the tag, Log a sale opens with that person already picked. Two taps left: the amount, then **Log it**. (After the CRM update Log a sale has three steps, policy, client, review, and needs that person's own sign-in on the phone; the link still picks the person for a manager or an admin.)

### Option B: a Shortcut that asks and posts (confetti without opening the app)
1. In Vercel, add `LOG_TOKEN` = any long random text (your password manager can make one; 24 or more characters, never under 12). Redeploy.
2. On an iPhone, open **Shortcuts** > **+** and add these actions in order:
   - **Choose from Menu** (or **Choose from List** with the team's names): the person.
   - **Ask for Input**, Number, prompt "Annual premium?".
   - **Choose from List** with the carriers (AHL, AmAm, Americo, Foresters, Newbridge, Royal, UHL).
   - **Get Contents of URL**: the address + `/api/sales`, Method **POST**, Headers `Authorization` = `Bearer ` + your LOG_TOKEN, Request Body **JSON**: `agent` = the chosen name, `premium` = the number, `carrier` = the chosen carrier.
   - **Show Result**: the contents.
3. Name it "Log a sale". Tap it once to test: the board celebrates within 5 seconds.
4. NFC: Shortcuts > **Automation** > **+** > **NFC** > scan a tag > run "Log a sale". One tag per desk, or one shared tag.

`agent` can be a first name when nobody shares it ("Alex"), else the full name; `carrier` must be one of the names in Settings (any case). Optional fields: `policies`, `product`, `date` (`YYYY-MM-DD`). After the CRM update a Shortcut sale lands with the status Submitted and no client details; the seller fills in the rest under **Policies**.

## Reference: all settings
- Required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OWNER_PASSWORD`.
- Recommended: `TEAM_PASSWORD` (without it only the owner can sign in), `APP_URL`.
- Optional: `LOG_TOKEN` (Shortcut endpoint), `SESSION_SECRET` (32+ characters; otherwise made from the Supabase key).
- Changing a password signs out every device that used it. The owner password also opens Settings and can fix or remove any sale; the team password can log sales and take one back within 15 minutes.
- Ten wrong passwords in 15 minutes lock that one phone or computer out for 15 minutes; everyone else is unaffected.
- Once the Lineage update (built 2026-11-12) is live: each person also has their own sign-in (cell number and password, made through a join link; see Getting everyone on). Four levels: you (the owner password, or your own sign-in), admins (goals, people, this month's sales, the board; two things wait for your yes under Approvals), members (their own sales and profile), and the team password (the TV and phones that have not joined yet; whether it can still log sales is your switch under Settings > Sign-ins). After the CRM update (Phase 1 Step 3, item 9): five, with **Manager** between admin and agent (their own sales and their team's: logging for a teammate, a teammate's status and notes, confirming who joins their team), members are called **Agent**, and the team password only shows the boards. A person's own password is theirs to change under their initials > Your profile; Sign out everywhere is there too.
- With that update the wrong tries are counted per address, and an office Wi-Fi is one address. The two sign-in screens are counted apart, so one never closes the other: ten wrong owner or team passwords in 15 minutes close that screen for everyone on the address; people's own sign-ins (cell number and password) have their own, larger count, 60 from one address and 20 on one person's account, and when that screen closes it says "Too many tries from this network. Wait a few minutes, or ask an admin for a new sign-in link." A closed screen opens again as the tries age out, 15 minutes at most. Typing your owner password right, while its screen is still open, clears that screen's count. Phones already signed in, the TV and the join link keep working.
- No cron jobs, no email, no AI in release 1.

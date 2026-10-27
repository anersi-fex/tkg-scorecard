# Scorecard setup (Anersi's clicks)

One step at a time. Each step says what you should see when it worked. Nothing here costs money (Supabase free tier and your existing Vercel plan are enough).

## Phase 1: the board on the TV (release 1)

### Step 1. Make a new Supabase project
1. Go to supabase.com and sign in (same account as Sales Coach).
2. Tap **New project**. Name: `scorecard`. Region: **East US (Ohio)**. Click **Generate a password**, save it in your password manager, then **Create new project**.
3. Wait about 2 minutes until the project dashboard shows.

### Step 2. Set up the database
1. In the project, open **SQL Editor** (left menu) and tap **New query**.
2. Paste everything in `supabase/migrations/0001_init.sql` and tap **Run**.
3. You should see **Success. No rows returned**.

### Step 3. Copy two values
1. **Project Settings** (gear) > **Data API**: copy the **Project URL** (it looks like `https://abcd.supabase.co`, nothing after `.co`).
2. **Project Settings** > **API Keys**: copy the **secret** key (starts with `sb_secret_`; on older screens it is the `service_role` key). Keep it private.

### Step 4. Put the app on Vercel
1. Go to vercel.com > **Add New** > **Project** > import `anersi-fex/tkg-scorecard`.
2. Before **Deploy**, open **Environment Variables** and add (names exactly as written):

| Name | Value |
|---|---|
| `SUPABASE_URL` | the Project URL from step 3 |
| `SUPABASE_SERVICE_ROLE_KEY` | the secret key from step 3 |
| `OWNER_PASSWORD` | a new strong password just for you (save it in your password manager) |
| `TEAM_PASSWORD` | a simpler password the whole team and the TV use (they can log sales, not change goals) |
| `APP_URL` | leave empty for now; after the deploy, add the address Vercel gives you (step 5) |

3. Tap **Deploy**. When it is done you get an address like `tkg-scorecard-xxxx.vercel.app`.

### Step 5. Tell the app its address
1. In Vercel, **Settings** > **Environment Variables** > add `APP_URL` = `https://` + the address from step 4 (no slash at the end).
2. **Deployments** > the top one > **…** > **Redeploy**. (The desk links on the Team page and link previews use this.)

### Step 6. Your team and your goal
1. Open the address on your phone, sign in with the **owner** password.
2. Tap **Team** and add each person (first and last name). All seven, you included.
3. Tap your initials (top right) > **Settings** > type the month's team goal in dollars of annual premium > **Save**.
4. Tap **Log a sale**, log one real sale. You should see "Logged" with a check mark.

### Step 7. The TV (Mac mini)
1. On the Mac mini, open Safari or Chrome and go to the address + `/board` (for example `https://tkg-scorecard-xxxx.vercel.app/board`).
2. Sign in with the **team** password. The board opens dark. It stays signed in for 180 days.
3. Press **F** for full screen. Press **T** if you want it light instead of dark.
4. System Settings > **Lock Screen**: set "Turn display off" to **Never** while the board is up. The page also asks the Mac to keep the screen awake.
5. Plug the HDMI transmitter into the Mac mini, the receiver into the TV. The board refreshes itself every 5 seconds; a new sale gets confetti.

### Step 8. Everyone's phone
1. Each person opens the address in Safari, signs in with the **team** password.
2. **Share** button > **Add to Home Screen** > **Add**. The icon is the podium.
3. They log their own sales from **Log a sale** (the app remembers who they picked last time).

That is release 1. Send Claude a photo of the TV: that is the proof.

## Phase 2: desk tags and a Shortcut (optional, after release 1 works)

### Option A, no Shortcut: a tag that opens Log a sale
1. On your phone, **Team** > a person > **Edit** > **Copy** their desk link.
2. Write that link to an NFC tag with any NFC writer app (NFC Tools is fine). When a phone touches the tag, Log a sale opens with that person already picked. Two taps left: the amount, then **Log it**.

### Option B: a Shortcut that asks and posts (confetti without opening the app)
1. In Vercel, add `LOG_TOKEN` = any long random text (your password manager can make one, 24+ characters). Redeploy.
2. On an iPhone, open **Shortcuts** > **+** and add these actions in order:
   - **Choose from Menu** (or **Choose from List** with the team's names): the person.
   - **Ask for Input**, Number, prompt "Annual premium?".
   - **Get Contents of URL**: the address + `/api/sales`, Method **POST**, Headers `Authorization` = `Bearer ` + your LOG_TOKEN, Request Body **JSON**: `agent` = the chosen name, `premium` = the number.
   - **Show Result**: the contents.
3. Name it "Log a sale". Tap it once to test: the board celebrates within 5 seconds.
4. NFC: Shortcuts > **Automation** > **+** > **NFC** > scan a tag > run "Log a sale". One tag per desk, or one shared tag.

`agent` can be a first name when nobody shares it ("Alex"), else the full name. Optional fields: `policies`, `product`, `client` (first name), `date` (`YYYY-MM-DD`).

## Reference: all settings
- Required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OWNER_PASSWORD`.
- Recommended: `TEAM_PASSWORD` (without it only the owner can sign in), `APP_URL`.
- Optional: `LOG_TOKEN` (Shortcut endpoint), `SESSION_SECRET` (32+ characters; otherwise made from the Supabase key).
- Changing a password signs out every device that used it. The owner password also opens Settings and can fix or remove any sale; the team password can log sales and take one back within 15 minutes.
- No cron jobs, no email, no AI in release 1.

# Bilkul free database — ₹0, koi card nahi, kabhi expire nahi

Ye guide aapko **permanently free** database dilata hai jo **kabhi delete nahi hota**,
aur usse panel ke saath jodta hai.

---

## Pehle: kaunsa free DB chunein

| Provider | Storage | Card? | Expire? | Idle pe kya hota hai | Verdict |
|---|---|---|---|---|---|
| **Neon** ⭐ | **1 GB** per project | ❌ nahi | **❌ kabhi nahi** | 5 min baad compute suspend, agli query pe ~500ms me wapas | **Ye chunein** |
| Supabase | 500 MB | ❌ nahi | ❌ nahi | 1 **hafte** idle pe pause, manually resume karna padta hai | Backup option |
| Aiven | 1 GB | ❌ nahi | ❌ nahi | suspend nahi, par chhota | Theek hai |
| ⚠️ **Render Postgres** | 1 GB | ❌ nahi | **✅ 30 din me DELETE** | — | **Mat use karein** |
| ⚠️ Railway | trial credit | card | credit khatam = band | — | Free nahi hai |

**Neon hi best hai:** 1 GB storage, no card, and Neon kehta hai *"none of its limits
delete your data"*. Compute suspend hota hai par **data safe rehta hai** — agli query pe
khud jaag jata hai.

> Hamara panel ka poora data ek JSON document hai. 1 GB me **lakhon** records aa jayenge —
> 5 workers, 500 advances, saal bhar ka data = kuch MB se zyada nahi. Free tier kaafi se
> zyada hai.

---

## Step 1 — Neon pe free database banayein (~2 min)

1. Kholiye: **https://neon.com** (ya `neon.tech`)
2. **Sign up** → **Continue with GitHub** (ya Google/email) — **card nahi maangta**
3. Project banayein:
   - **Project name:** `jbb-panel`
   - **Region:** `AWS ap-southeast-1` (Singapore) — India se sabse kam latency
   - **Postgres version:** default chhod dein
4. **Create project** dabayein

Project khulte hi ek **Connection string** dikhegi. Usse copy karein. Aisa dikhega:

```
postgresql://neondb_owner:npg_XXXXXXXXXXXX@ep-cool-name-12345678.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
```

> ⚠️ **`?sslmode=require` wala part mat hatayein** — Neon ko SSL chahiye.
> Agar **Dashboard → Connect** me "Pooled connection" ka toggle dikhe to usse **on** hi
> rakhein — serverless ke liye behtar hai.

**Ye string password jaisi hai.** Kisi ko na dein, screenshot me share na karein.

---

## Step 2 — Server deploy karein (Render, free)

1. Kholiye: **https://render.com/deploy?repo=https://github.com/akash4447777-dev/jbb-panel-new**
2. **Sign in with GitHub** → repo approve karein
3. Blueprint khulega — **Apply** dabayein
4. **`DATABASE_URL`** maanga jayega → **Step 1 wali Neon string paste karein**
5. **Apply / Create** dabayein

Render banayega:
- Web server (`server.js`)
- `JBB_SECRET` — auto-generated (login tokens sign karta hai)
- `STORE_MODE=postgres`

~2 minute me URL milega, jaise `https://jbb-panel-abc1.onrender.com`.

> Render free web service **15 min idle ke baad sota hai**. Pehla request ~40 sec lega.
> **Data safe rehta hai** (wo Neon me hai, Render pe nahi) — sirf process sota hai.
> Ye server ke liye limit hai, database ke liye nahi.

---

## Step 3 — Check karein ki chal gaya

Browser me kholein:

```
https://YOUR-APP.onrender.com/api/health
```

Aisa dikhna chahiye:

```json
{
  "ok": true,
  "ver": 0,
  "users": 0,
  "store": "postgres",
  "degraded": false
}
```

**`"store": "postgres"` aur `"degraded": false` — ye do cheezein sabse important hain.**
Matlab database se jud gaya hai aur sab theek hai.

Agar `"degraded": true` ho → DB connect nahi hua. `lastStoreError` me reason dikhega.
Sabse common galti: `?sslmode=require` missing.

> Pehli baar `/api/health` khulte waqt Neon suspend me hoga — 1–2 second lag sakta hai.
> Ye normal hai.

---

## Step 4 — Panel ko cloud se jodein

Ye link kisi bhi device pe kholein:

```
https://akash4447777-dev.github.io/jbb-panel-new/?api=https://YOUR-APP.onrender.com
```

Ab sab devices **ek hi data** dekhenge. Phone pe "Add to Home Screen" kar lein — app jaisa
lagne lagega.

Login: koi bhi Gmail/mobile + 4+ char password. **Pehla account Admin banega.**

---

## Neon ke free tier ki asli limits (honest)

| Limit | Value | Aapke liye matlab |
|---|---|---|
| Storage | **1 GB** / project | lakhon records. Kabhi nahi bharayega. |
| Compute | 100 CU-hours / month | Idle pe suspend rehta hai, to aam use me khatam nahi hoga |
| Suspend | 5 min idle ke baad | Agli query ~500ms me jaag jati hai. Panel pe farak nahi padega |
| Data delete | **kabhi nahi** | Neon: *"none of its limits delete your data"* |
| Card | nahi chahiye | ✅ |
| Expiry | **nahi** | ✅ |

**Ek hi risk:** agar mahine me 100 CU-hours khatam ho jaye to compute **agle mahine tak**
suspend rahega. Tab DB band, par **data safe**. Ye tabhi hoga jab 24/7 heavy load ho —
aapke use me nahi.

---

## Backup (zaroor karein)

Neon pe data safe hai, par phir bhi:

- Panel → **Settings → ⬇ Export backup** → JSON file download
- Mahine me ek baar kar lein, phone/laptop me rakh lein

**Restore** usi dialog se kisi bhi device pe ho jata hai.

---

## Agar kuch gadbad ho jaye

| Problem | Karan | Fix |
|---|---|---|
| `"degraded": true` | DB connect fail | `?sslmode=require` check karein |
| `"store": "file"` | `DATABASE_URL` set nahi | Render → Environment → variable add karein |
| Health pe 500 | `pg` install nahi hua | Render logs dekhein, `npm install` dobara |
| Pehla load 40 sec | Render free tier so raha hai | Normal, dobara refresh |
| Data gayab | Render pe file mode chal raha tha | Neon string add karein, redeploy |

Server **crash nahi karta** agar DB down ho — file storage pe chalta rehta hai aur
`/api/health` pe `degraded: true` dikha deta hai. Isse data loss nahi hota, bas
temporary rehta hai.

---

## Bina DB ke chalana hai?

Bilkul chalega — **GitHub Pages wala link** (offline mode) already aapke paas hai:

**https://akash4447777-dev.github.io/jbb-panel-new/**

Data har device pe alag rehta hai (browser me). Ek hi device pe kaam karna ho to
**DB ki zarurat hi nahi**. Export backup se safety rakh lein.

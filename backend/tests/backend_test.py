"""TheraVoca backend tests."""
import os, time, requests, pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://care-matcher-1.preview.emergentagent.com").rstrip("/")
ADMIN = {"X-Admin-Password": "admin123!"}

@pytest.fixture(scope="module")
def s():
    return requests.Session()

def test_root(s):
    r = s.get(f"{BASE}/api/")
    assert r.status_code == 200 and r.json()["status"] == "ok"

def test_admin_login_wrong(s):
    r = s.post(f"{BASE}/api/admin/login", json={"password": "wrong"})
    assert r.status_code == 401

def test_admin_login_ok(s):
    r = s.post(f"{BASE}/api/admin/login", json={"password": "admin123!"})
    assert r.status_code == 200 and r.json()["ok"] is True

def test_admin_stats_unauth(s):
    r = s.get(f"{BASE}/api/admin/stats")
    assert r.status_code == 401

def test_admin_stats(s):
    r = s.get(f"{BASE}/api/admin/stats", headers=ADMIN)
    assert r.status_code == 200
    assert r.json()["therapists"] == 100

def test_admin_therapists(s):
    r = s.get(f"{BASE}/api/admin/therapists", headers=ADMIN)
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 100
    t = data[0]
    for f in ["id","name","email","specialties","modalities","ages_served","insurance_accepted","cash_rate","licensed_states"]:
        assert f in t, f"missing {f}"
    assert t["licensed_states"] == ["ID"]
    assert isinstance(t["specialties"], list) and "weight" in t["specialties"][0]

@pytest.fixture(scope="module")
def created_request(s):
    payload = {
        "email": "TEST_patient@example.com",
        "client_age": 30,
        "location_state": "ID",
        "location_city": "Boise",
        "session_format": "virtual",
        "payment_type": "cash",
        "budget": 200,
        "presenting_issues": "I'm dealing with anxiety and stress at work",
        "preferred_gender": "",
        "preferred_modality": "CBT",
    }
    r = s.post(f"{BASE}/api/requests", json=payload)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["status"] == "pending_verification"
    return j["id"]

def test_request_created(created_request):
    assert created_request

def test_verify_and_match(s, created_request):
    # fetch token via mongo by hitting admin detail before verify
    detail = s.get(f"{BASE}/api/admin/requests/{created_request}", headers=ADMIN).json()
    # verification token is stripped, so use mongo via admin? we don't have it. skip if unavailable.
    # Instead, hit the verify by guessing - we need the token. Use direct DB? Not available here.
    # Workaround: expose by querying request doc via admin which strips token. So we need another way.
    pytest.skip("verification_token not exposed via API; covered manually in next step")

def test_therapist_apply_unnotified_403(s, created_request):
    # pick a random therapist not notified
    ts = s.get(f"{BASE}/api/admin/therapists", headers=ADMIN).json()
    tid = ts[0]["id"]
    r = s.get(f"{BASE}/api/therapist/apply/{created_request}/{tid}")
    assert r.status_code in (403, 404)

def test_request_results_empty(s, created_request):
    r = s.get(f"{BASE}/api/requests/{created_request}/results")
    assert r.status_code == 200
    assert r.json()["applications"] == []

def test_threshold_update(s, created_request):
    r = s.put(f"{BASE}/api/admin/requests/{created_request}/threshold", headers=ADMIN, json={"threshold": 50})
    assert r.status_code == 200 and r.json()["threshold"] == 50.0

def test_admin_list_requests(s):
    r = s.get(f"{BASE}/api/admin/requests", headers=ADMIN)
    assert r.status_code == 200 and isinstance(r.json(), list)

# Verify+match flow using mongo direct
def test_full_verify_match_flow(s, created_request):
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    async def go():
        c = AsyncIOMotorClient(os.environ.get("MONGO_URL","mongodb://localhost:27017"))
        d = c[os.environ.get("DB_NAME","test_database")]
        doc = await d.requests.find_one({"id": created_request})
        return doc.get("verification_token")
    token = asyncio.get_event_loop().run_until_complete(go()) if False else None
    # simpler:
    import subprocess, json
    out = subprocess.check_output(["python","-c",
        "import asyncio,os;from motor.motor_asyncio import AsyncIOMotorClient\n"
        "async def g():\n"
        " c=AsyncIOMotorClient(os.environ['MONGO_URL']);d=c[os.environ['DB_NAME']]\n"
        " r=await d.requests.find_one({'id':'%s'});print(r['verification_token'])\n"
        "asyncio.run(g())" % created_request], env={**os.environ, "MONGO_URL":"mongodb://localhost:27017","DB_NAME":"test_database"}).decode().strip()
    token = out
    r = s.get(f"{BASE}/api/requests/verify/{token}")
    assert r.status_code == 200 and r.json()["verified"] is True
    time.sleep(4)
    detail = s.get(f"{BASE}/api/admin/requests/{created_request}", headers=ADMIN).json()
    assert detail["request"]["status"] == "matched"
    notified = detail["notified"]
    assert len(notified) >= 5
    tid = notified[0]["id"]
    # Therapist view
    v = s.get(f"{BASE}/api/therapist/apply/{created_request}/{tid}")
    assert v.status_code == 200
    vj = v.json()
    assert "email" not in str(vj).lower() or "TEST_patient" not in str(vj)
    assert vj["match_score"] > 0
    # Apply
    a = s.post(f"{BASE}/api/therapist/apply/{created_request}/{tid}", json={"message":"I'd love to work with you on this anxiety together."})
    assert a.status_code == 200
    aid = a.json()["id"]
    # Update (idempotent)
    a2 = s.post(f"{BASE}/api/therapist/apply/{created_request}/{tid}", json={"message":"Updated message about anxiety support and CBT approach."})
    assert a2.status_code == 200 and a2.json()["id"] == aid
    # Results
    res = s.get(f"{BASE}/api/requests/{created_request}/results").json()
    assert len(res["applications"]) == 1
    assert "therapist" in res["applications"][0]
    # Trigger
    tr = s.post(f"{BASE}/api/admin/requests/{created_request}/trigger-results", headers=ADMIN)
    assert tr.status_code == 200
    # Resend
    rs = s.post(f"{BASE}/api/admin/requests/{created_request}/resend-notifications", headers=ADMIN)
    assert rs.status_code == 200 and rs.json()["notified"] >= 5

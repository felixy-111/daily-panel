"""Phase 0 spike: throwaway probe of Notion recurring-task behaviour via API.
Only touches a dedicated test task named TEST_NAME. Usage:
  python3 spike/notion_probe.py create|complete|inspect|cleanup
"""
import json, os, sys, time, urllib.request
from datetime import datetime, timedelta, timezone

DS = "1e48744e-b435-815b-9c89-000b5f1672dc"
TEST_NAME = "zz-habit-sync-test"
TOKEN = os.environ["NOTION_TOKEN"]
TPE = timezone(timedelta(hours=8))


def api(method, path, body=None):
    req = urllib.request.Request(
        "https://api.notion.com/v1" + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"Authorization": "Bearer " + TOKEN, "Notion-Version": "2025-09-03",
                 "Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code} {path}: {e.read()[:400]}")


def find_tests():
    r = api("POST", f"/data_sources/{DS}/query", {
        "filter": {"property": "Name", "title": {"equals": TEST_NAME}}, "page_size": 50})
    return r["results"]


def summary(p):
    pr = p["properties"]
    g = lambda k, f: pr.get(k, {}).get(f)
    return {
        "id": p["id"], "archived": p.get("in_trash") or p.get("archived"),
        "Status": (g("Status", "status") or {}).get("name"),
        "Due": (g("Due", "date") or {}).get("start"),
        "Completed": (g("Completed", "date") or {}).get("start"),
        "Recur Interval": g("Recur Interval", "number"),
        "Value": g("Value", "number"),
        "Occurrences": [x["id"] for x in g("Occurrences", "relation") or []],
        "Parent-ish relations": {k: [x["id"] for x in v.get("relation", [])]
                                 for k, v in pr.items() if v["type"] == "relation" and v.get("relation")},
        "created": p["created_time"],
    }


cmd = sys.argv[1]
today = datetime.now(TPE).date().isoformat()

if cmd == "create":
    if find_tests():
        sys.exit("test task already exists; run cleanup first")
    p = api("POST", "/pages", {
        "parent": {"type": "data_source_id", "data_source_id": DS},
        "properties": {"Name": {"title": [{"text": {"content": TEST_NAME}}]},
                       "Due": {"date": {"start": today}},
                       "Recur Interval": {"number": 1},
                       "Recur Unit": {"select": {"name": "Day(s)"}}}})
    print(json.dumps(summary(p), ensure_ascii=False, indent=1))

elif cmd == "complete":
    orig = [p for p in find_tests() if p["properties"]["Recur Interval"]["number"]]
    assert len(orig) == 1, f"expected 1 recurring test task, got {len(orig)}"
    pid = orig[0]["id"]
    api("PATCH", f"/pages/{pid}", {"properties": {"Value": {"number": 7},
                                                   "Status": {"status": {"name": "Done"}}}})
    print("set Value=7, Status=Done at", datetime.now(timezone.utc).isoformat())
    for i in range(12):
        time.sleep(10)
        tests = find_tests()
        if len(tests) > 1 or (api("GET", f"/pages/{pid}")["properties"]["Status"]["status"]["name"] != "Done"):
            break
    for p in find_tests():
        print(json.dumps(summary(p), ensure_ascii=False, indent=1))

elif cmd == "inspect":
    for p in find_tests():
        print(json.dumps(summary(p), ensure_ascii=False, indent=1))

elif cmd == "cleanup":
    for p in find_tests():
        api("PATCH", f"/pages/{p['id']}", {"in_trash": True})
        print("trashed", p["id"])

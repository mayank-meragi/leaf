import json
import threading
import unittest
import urllib.error
import urllib.request

from leaf_backend.serve import MAX_SCHEMES, environment_problem, make_server

ORIGIN = "http://localhost:5180"


def fake_fetch(code: int, name: str) -> dict:
    if code == 404:
        raise LookupError(f"no page found for {name!r}")
    return {"code": code, "name": name, "holdings": [{"id": "x", "name": "X", "sector": None, "type": "EQUITY", "weight": 1.0}]}


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = make_server(port=0, origins=[ORIGIN], fetcher=fake_fetch, delay=0, quiet=True)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def call(self, path, body=None, origin=ORIGIN, method=None):
        headers = {"Content-Type": "application/json"}
        if origin:
            headers["Origin"] = origin
        req = urllib.request.Request(self.base + path, data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, dict(r.headers), r.read().decode()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read().decode()

    def test_health_reports_the_python_in_use(self):
        _, _, body = self.call("/health")
        self.assertRegex(json.loads(body)["python"], r"^3\.\d+")

    def test_this_environment_passes_its_own_check(self):
        self.assertIsNone(environment_problem())

    def test_binds_to_loopback_only(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")

    def test_health_allows_the_app_origin(self):
        status, headers, body = self.call("/health")
        self.assertEqual((status, json.loads(body)["ok"]), (200, True))
        self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)

    def test_other_websites_are_refused(self):
        for path, body in (("/health", None), ("/holdings", {"schemes": [{"code": 1, "name": "A"}]})):
            status, headers, _ = self.call(path, body, origin="https://evil.example")
            self.assertEqual(status, 403)
            self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_preflight(self):
        status, headers, _ = self.call("/holdings", origin=ORIGIN, method="OPTIONS")
        self.assertEqual(status, 204)
        self.assertIn("POST", headers["Access-Control-Allow-Methods"])
        self.assertEqual(self.call("/holdings", origin="https://evil.example", method="OPTIONS")[0], 403)

    def test_streams_one_line_per_scheme_and_keeps_going_after_a_failure(self):
        status, headers, body = self.call("/holdings", {"schemes": [{"code": 1, "name": "A"}, {"code": 404, "name": "Ghost"}, {"code": 3, "name": "C"}]})
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "application/x-ndjson")
        lines = [json.loads(x) for x in body.splitlines()]
        self.assertEqual([x["code"] for x in lines], [1, 404, 3])
        self.assertIn("doc", lines[0])
        self.assertIn("LookupError", lines[1]["error"])
        self.assertEqual(lines[2]["doc"]["name"], "C")

    def test_rejects_bad_requests(self):
        self.assertEqual(self.call("/holdings", {"schemes": []})[0], 400)
        self.assertEqual(self.call("/holdings", {"nope": 1})[0], 400)
        self.assertEqual(self.call("/holdings", {"schemes": [{"code": "abc", "name": "A"}]})[0], 400)
        self.assertEqual(self.call("/holdings", {"schemes": [{"code": i, "name": "A"} for i in range(MAX_SCHEMES + 1)]})[0], 400)
        self.assertEqual(self.call("/nope")[0], 404)

    def test_scripts_without_an_origin_header_still_work(self):
        self.assertEqual(self.call("/health", origin=None)[0], 200)


if __name__ == "__main__":
    unittest.main()

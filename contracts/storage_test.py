# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *


# Minimal sanity contract. Deploy this FIRST on GenLayer Studio to confirm the
# environment works before deploying the real GrantGuard contract.
#
#   Settings -> Reset Storage -> Confirm -> Hard refresh -> deploy this file ->
#   verify Result: SUCCESS (not just Status: FINALIZED).
class Contract(gl.Contract):
    notes: TreeMap[str, str]
    write_count: u256

    def __init__(self):
        # Only scalar fields here. NEVER assign self.notes = TreeMap().
        self.write_count = u256(0)

    @gl.public.write
    def put(self, key: str, value: str) -> None:
        self.notes[key] = value
        self.write_count = self.write_count + u256(1)

    @gl.public.view
    def get(self, key: str) -> str:
        if key in self.notes:
            return self.notes[key]
        return ""

    @gl.public.view
    def count(self) -> u256:
        return self.write_count

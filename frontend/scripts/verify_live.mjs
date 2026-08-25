// Live-contract smoke test. No wallet required — this proves the deployed
// GrantGuard is alive, has the expected schema, and is reachable through
// standard genlayer-js reads.
//
//   cd frontend
//   node ../scripts/verify_live.mjs                # uses .env
//   node ../scripts/verify_live.mjs 0xNEW_ADDRESS  # override
//
// Exit code 0 = every check passed. Anything else prints the failure.

import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const OVERRIDE = process.argv[2];
const ADDRESS = OVERRIDE || process.env.VITE_GRANTGUARD_CONTRACT_ADDRESS;

if (!ADDRESS) {
  console.error(
    "Missing contract address. Pass it as the first argument or set VITE_GRANTGUARD_CONTRACT_ADDRESS."
  );
  process.exit(2);
}

const REQUIRED = [
  "cancel_grant",
  "create_grant",
  "get_grant",
  "get_milestone",
  "get_withdrawable",
  "review_milestone",
  "submit_milestone",
  "total_grants",
  "withdraw",
];

const client = createClient({ chain: studionet });

async function main() {
  console.log(`▶ verifying ${ADDRESS} on studionet …`);

  const schema = await client.getContractSchema(ADDRESS);
  const methods = Object.keys(schema.methods ?? {});
  const missing = REQUIRED.filter((m) => !methods.includes(m));
  if (missing.length) {
    console.error(`✗ schema is missing methods: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log(`✓ schema exposes all ${REQUIRED.length} required methods`);

  const total = await client.readContract({
    address: ADDRESS,
    functionName: "total_grants",
    args: [],
    jsonSafeReturn: false,
  });
  const totalNum = Number(total);
  console.log(`✓ total_grants = ${totalNum}`);

  const probeCount = Math.max(3, totalNum);
  let readableGrants = 0;
  for (let i = 0; i < probeCount; i++) {
    const raw = await client.readContract({
      address: ADDRESS,
      functionName: "get_grant",
      args: [i],
    });
    if (typeof raw === "string" && raw !== "{}") {
      readableGrants += 1;
      const preview = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
      console.log(`  · grant ${i}: ${preview}`);
    }
  }

  if (totalNum > 0 && readableGrants === 0) {
    console.error(
      "✗ total_grants > 0 but no grants were readable — chain state may be stale."
    );
    process.exit(1);
  }

  if (totalNum === 0) {
    console.log("ℹ state is empty (no grants yet) — seed a grant before demoing.");
  }

  console.log("✓ live contract is healthy");
}

main().catch((err) => {
  console.error("✗ live check failed:", err.message || err);
  process.exit(1);
});

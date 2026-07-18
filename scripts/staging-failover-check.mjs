const loadBalancerUrl = requiredUrl("STAGING_BASE_URL");
const instanceUrls = (process.env.STAGING_INSTANCE_URLS ?? "")
  .split(",")
  .map((value) => value.trim().replace(/\/$/, ""))
  .filter(Boolean);
if (instanceUrls.length !== 2 || new Set(instanceUrls).size !== 2) {
  throw new Error("STAGING_INSTANCE_URLS must contain exactly two distinct comma-separated URLs");
}
for (const instanceUrl of instanceUrls) validateUrl(instanceUrl, "STAGING_INSTANCE_URLS");

const expectedDown = process.env.STAGING_EXPECT_DOWN_URL?.replace(/\/$/, "");
if (expectedDown && !instanceUrls.includes(expectedDown)) {
  throw new Error("STAGING_EXPECT_DOWN_URL must be one of STAGING_INSTANCE_URLS");
}
const requests = positiveInteger("FAILOVER_REQUESTS", 50);

async function readiness(baseUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${baseUrl}/api/health/ready`, {
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) return { ready: false, upstream: null };
    const payload = await response.json();
    return {
      ready: payload.status === "ok" && payload.checks?.database === "ok",
      upstream: response.headers.get("x-foodgood-upstream"),
    };
  } catch {
    return { ready: false, upstream: null };
  } finally {
    clearTimeout(timeout);
  }
}

const instanceResults = await Promise.all(instanceUrls.map(async (url) => {
  const result = await readiness(url);
  return { url, ready: result.ready };
}));
if (expectedDown) {
  const down = instanceResults.find((result) => result.url === expectedDown);
  const survivor = instanceResults.find((result) => result.url !== expectedDown);
  if (down?.ready) throw new Error(`Expected stopped instance is still ready: ${expectedDown}`);
  if (!survivor?.ready) throw new Error(`Surviving instance is not ready: ${survivor?.url}`);
} else if (instanceResults.some((result) => !result.ready)) {
  throw new Error(`Baseline requires both instances ready: ${JSON.stringify(instanceResults)}`);
}

let loadBalancerFailures = 0;
const loadBalancerUpstreams = new Set();
for (let index = 0; index < requests; index += 1) {
  const result = await readiness(loadBalancerUrl);
  if (!result.ready) loadBalancerFailures += 1;
  if (result.upstream) {
    for (const upstream of result.upstream.split(",")) loadBalancerUpstreams.add(upstream.trim());
  }
}
if (loadBalancerFailures) {
  throw new Error(`Load balancer failed ${loadBalancerFailures}/${requests} readiness requests`);
}
const expectedUpstreams = expectedDown ? 1 : 2;
if (loadBalancerUpstreams.size !== expectedUpstreams) {
  throw new Error(`Load balancer used ${loadBalancerUpstreams.size} distinct upstreams; expected ${expectedUpstreams}`);
}

console.log(JSON.stringify({
  status: "passed",
  mode: expectedDown ? "single-instance-failover" : "two-instance-baseline",
  checkedAt: new Date().toISOString(),
  instanceResults,
  loadBalancerRequests: requests,
  loadBalancerFailures,
  loadBalancerUpstreams: [...loadBalancerUpstreams].sort(),
}, null, 2));

function requiredUrl(name) {
  const value = process.env[name]?.replace(/\/$/, "");
  if (!value) throw new Error(`${name} is required`);
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`${name} must be an HTTP(S) URL`);
  return value;
}

function validateUrl(value, name) {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`${name} must contain only HTTP(S) URLs`);
}

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 10_000) {
    throw new Error(`${name} must be an integer between 1 and 10000`);
  }
  return value;
}

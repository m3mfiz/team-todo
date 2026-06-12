// E2E smoke: proves auth + role-based visibility against a running server.
// Usage: node scripts/smoke.mjs [baseUrl]   (default http://localhost:3002)
const BASE = process.argv[2] ?? 'http://127.0.0.1:3002';

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ok ${name}`);
  } else {
    failed++;
    console.error(`FAIL ${name} ${extra}`);
  }
}

async function req(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON response */
  }
  return { status: res.status, json };
}

async function login(username, password) {
  const r = await req('POST', '/api/auth/login', { body: { username, password } });
  if (r.status !== 200) throw new Error(`login ${username} -> ${r.status}`);
  return r.json;
}

const health = await req('GET', '/api/health');
check('health', health.status === 200 && health.json?.ok === true);

const admin = await login('admin', process.env.ADMIN_PASSWORD ?? 'admin123');
check('admin login', admin.user?.role === 'admin');

// Self-contained roster: the seed users may have been deleted/renamed by the
// admin, so the smoke creates its own throwaway members and removes them at
// the end.
const runId = String(Date.now() % 1e9);
async function createMember(tag) {
  const r = await req('POST', '/api/admin/users', {
    token: admin.accessToken,
    body: {
      username: `smoke${tag}${runId}`.slice(0, 30),
      displayName: `Смоук-${tag}`,
      password: `smoke-${tag}-pw1`,
    },
  });
  if (r.status !== 201) throw new Error(`create smoke member ${tag} -> ${r.status}`);
  return r.json;
}
const userA = await createMember('a');
const userB = await createMember('b');
const ivan = await login(userA.username, 'smoke-a-pw1');
const maria = await login(userB.username, 'smoke-b-pw1');
check('member login', ivan.user?.role === 'member' && maria.user?.role === 'member');

const stamp = Date.now();

// admin -> task for ivan
const tIvan = await req('POST', '/api/tasks', {
  token: admin.accessToken,
  body: { title: `smoke-ivan-${stamp}`, assigneeId: ivan.user.id },
});
check('admin creates task for ivan', tIvan.status === 201 || tIvan.status === 200, `status=${tIvan.status}`);

// admin -> task for everyone
const tAll = await req('POST', '/api/tasks', {
  token: admin.accessToken,
  body: { title: `smoke-all-${stamp}`, assigneeId: null },
});
check('admin creates everyone-task', tAll.status === 201 || tAll.status === 200, `status=${tAll.status}`);

// ivan -> own task
const tOwn = await req('POST', '/api/tasks', {
  token: ivan.accessToken,
  body: { title: `smoke-own-${stamp}` },
});
check('member creates own task', tOwn.status === 201 || tOwn.status === 200, `status=${tOwn.status}`);

// ivan must NOT create for maria
const tForbidden = await req('POST', '/api/tasks', {
  token: ivan.accessToken,
  body: { title: `smoke-bad-${stamp}`, assigneeId: maria.user.id },
});
check('member cannot assign to others (403)', tForbidden.status === 403, `status=${tForbidden.status}`);

const titles = (r) => (r.json ?? []).map((t) => t.title);
const ivanList = await req('GET', '/api/tasks', { token: ivan.accessToken });
check('ivan sees his assigned task', titles(ivanList).includes(`smoke-ivan-${stamp}`));
check('ivan sees everyone-task', titles(ivanList).includes(`smoke-all-${stamp}`));
check('ivan sees his own task', titles(ivanList).includes(`smoke-own-${stamp}`));

const mariaList = await req('GET', '/api/tasks', { token: maria.accessToken });
check('maria does NOT see ivan task', !titles(mariaList).includes(`smoke-ivan-${stamp}`));
check('maria does NOT see ivan own task', !titles(mariaList).includes(`smoke-own-${stamp}`));
check('maria sees everyone-task', titles(mariaList).includes(`smoke-all-${stamp}`));

const adminList = await req('GET', '/api/tasks', { token: admin.accessToken });
check('admin sees member-created task', titles(adminList).includes(`smoke-own-${stamp}`));

// complete + reopen
const done = await req('PATCH', `/api/tasks/${tOwn.json.id}`, {
  token: ivan.accessToken,
  body: { status: 'done' },
});
check('member completes own task', done.status === 200 && done.json?.status === 'done' && !!done.json?.completedAt);
const reopen = await req('PATCH', `/api/tasks/${tOwn.json.id}`, {
  token: ivan.accessToken,
  body: { status: 'open' },
});
check('reopen works', reopen.status === 200 && reopen.json?.status === 'open');

// unauthorized
const noAuth = await req('GET', '/api/tasks');
check('401 without token', noAuth.status === 401);

// cleanup smoke tasks and throwaway members (admin)
for (const t of [tIvan, tAll, tOwn]) {
  if (t.json?.id) await req('DELETE', `/api/tasks/${t.json.id}`, { token: admin.accessToken });
}
for (const u of [userA, userB]) {
  const del = await req('DELETE', `/api/admin/users/${u.id}`, { token: admin.accessToken });
  check(`cleanup member ${u.displayName}`, del.status === 200);
}

console.log(`\nSmoke: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

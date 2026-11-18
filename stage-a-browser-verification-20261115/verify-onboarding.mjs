import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import WebSocket from 'ws';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

dotenv.config({ path: resolve(process.cwd(), '.env') });
const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const emailPrefix = `stagea-browser-${suffix}`;
const password = 'StageA!Browser2026';
const artifactDirectory = resolve(process.cwd(), 'stage-a-browser-verification-20261115');
if (existsSync(artifactDirectory)) throw new Error('Browser artifact directory already exists; refusing to overwrite.');
mkdirSync(artifactDirectory);
const accounts = [];
const tripIds = [];
const expectedTripNames = [];
const screenshots = [];
const browserLogs = [];
const acceptanceResults = [];
let browser;
let ws;
let sequence = 0;
const pending = new Map();
const checks = [];
const requestUrls = new Map();
let ownerId;
let runStatus = 'running';
let runError = null;
let baselineIntegrityHash;
let finalIntegrityHash;
let createdInvitationIds = [];

async function integrityHash() {
  const trips = await prisma.trip.findMany({ select: { id: true, createdAt: true, updatedAt: true }, orderBy: { id: 'asc' } });
  const [users, members, settings, budgets, expenses, financialEntries, settlements, invitations, notifications, audits, outbox, reviews] = await Promise.all([
    prisma.user.findMany({ select: { id: true, createdAt: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    prisma.tripMember.findMany({ orderBy: { id: 'asc' } }),
    prisma.tripSetting.findMany({ orderBy: { id: 'asc' } }),
    prisma.memberBudget.findMany({ orderBy: { id: 'asc' } }),
    prisma.expense.findMany({ include: { payers: true, allocations: true, locations: true, receipts: true }, orderBy: { id: 'asc' } }),
    prisma.financialEntry.findMany({ orderBy: { id: 'asc' } }),
    prisma.settlement.findMany({ orderBy: { id: 'asc' } }),
    prisma.tripInvitation.findMany({ orderBy: { id: 'asc' } }),
    prisma.notification.findMany({ orderBy: { id: 'asc' } }),
    prisma.auditLog.findMany({ orderBy: { id: 'asc' } }),
    prisma.outboxEvent.findMany({ orderBy: { id: 'asc' } }),
    prisma.settlementExpenseReview.findMany({ orderBy: { id: 'asc' } }),
  ]);
  const settlementsIds = settlements.map((settlement) => settlement.id);
  const payments = await prisma.settlementPayment.findMany({ where: { settlementId: { in: settlementsIds } }, include: { refunds: true, ledgerEntries: true, events: true }, orderBy: { id: 'asc' } });
  const settlementLedger = await prisma.settlementLedgerEntry.findMany({ orderBy: { id: 'asc' } });
  const snapshot = { trips, users, members, settings, budgets, expenses, financialEntries, settlements, payments, settlementLedger, invitations, notifications, audits, outbox, reviews };
  return createHash('sha256').update(JSON.stringify(snapshot, (_key, value) => typeof value === 'bigint' ? value.toString() : value)).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  checks.push(message);
}

function request(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }
    }, 8000);
  });
}

async function evaluate(expression) {
  try {
    const result = await request('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.result.exceptionDetails) throw new Error(result.result.exceptionDetails.text ?? 'Browser evaluation failed.');
    return result.result.result.value;
  } catch (error) {
    throw new Error(`Browser evaluation failed for: ${expression.slice(0, 180)}; ${error instanceof Error ? error.message : error}`);
  }
}

async function screenshot(name) {
  const result = await request('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
  const path = join(artifactDirectory, name);
  writeFileSync(path, Buffer.from(result.result.data, 'base64'));
  screenshots.push({ name, path: basename(path) });
}

async function responseStatus(url, method, token, body) {
  const options = { method, headers: { Authorization: `Bearer ${token}` } };
  if (method !== 'GET') {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body ?? {});
  }
  return evaluate(`fetch(${JSON.stringify(url)}, ${JSON.stringify(options)}).then((response) => response.status)`);
}

async function createTripViaUi(name, startDate, endDate, currency) {
  await clickButton('Create trip');
  await setField('input[placeholder="Coastal weekend"]', name);
  await setField('select', currency);
  await setField('input[type=date]', startDate);
  await setField('input[type=date]@1', endDate);
  await setField('textarea', 'Temporary browser verification trip');
  const submitted = await evaluate("(() => { const form = [...document.querySelectorAll('form')].find((item) => item.querySelector('input[placeholder=\"Coastal weekend\"]')); if (!form) return false; form.requestSubmit(); return true; })()");
  assert(submitted, 'Submitted the trip creation form in Chrome');
  await waitFor("location.pathname.startsWith('/trips/') && document.body.innerText.includes('Trip members')", 'trip management page');
  const tripId = await evaluate("location.pathname.split('/').pop()");
  tripIds.push(tripId);
  expectedTripNames.push(name);
  const ownerToken = await getToken();
  const tripResponse = await fetch(`http://localhost:4000/api/trips/${tripId}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  const payload = await tripResponse.json();
  assert(tripResponse.ok && payload.trip.startDate.startsWith(startDate) && payload.trip.endDate.startsWith(endDate), 'Trip dates were persisted through the browser workflow');
  assert(payload.trip.baseCurrency === currency && payload.trip.settings, 'Currency and initial trip settings were persisted');
  return tripId;
}

async function waitFor(expression, description, timeout = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  console.error('Browser state at timeout:', await evaluate("({ url: location.href, ready: document.readyState, title: document.title, body: document.body?.innerText?.slice(0, 1200) })"));
  throw new Error(`Timed out waiting for browser state: ${description}`);
}

async function clickButton(text) {
  const clicked = await evaluate(`(() => { const button = [...document.querySelectorAll('button, a')].find((item) => item.textContent.trim().includes(${JSON.stringify(text)})); if (!button) return false; button.click(); return true; })()`);
  assert(clicked, `Found and clicked “${text}”`);
}

async function setField(selector, value) {
  const index = selector.endsWith('@1') ? 1 : 0;
  const query = selector.replace(/@1$/, '');
  const changed = await evaluate(`(() => { const field = document.querySelectorAll(${JSON.stringify(query)})[${index}]; if (!field) return false; const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value').set; setter.call(field, ${JSON.stringify(value)}); field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  assert(changed, `Found form field ${selector}`);
}

async function getToken() {
  return evaluate("localStorage.getItem('tripledger_token')");
}

async function currentUser(token) {
  const response = await fetch('http://localhost:4000/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error('Could not read the browser session account.');
  return response.json();
}

async function registerAccount(index, fullName) {
  const email = `${emailPrefix}-${index}@example.test`;
  const response = await fetch('http://localhost:4000/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName, email, password }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Fixture account registration failed with ${response.status}.`);
  accounts.push({ id: payload.user.id, email: payload.user.email });
  return payload;
}

async function login(email, name) {
  await request('Page.navigate', { url: 'http://localhost:5173/' });
  await waitFor("location.pathname === '/' && !!document.querySelector('input[type=email]')", `${name} login screen`);
  await setField('input[type=email]', email);
  await setField('input[type=password]', password);
  await clickButton('Sign in to TripLedger');
  await waitFor("location.pathname === '/trips'", `${name} My Trips screen`);
  assert((await evaluate('document.body.innerText')).includes('My trips'), `${name} signed in through the browser`);
}

async function main() {
  baselineIntegrityHash = await integrityHash();
  const newTarget = await fetch('http://127.0.0.1:9223/json/new?about:blank', { method: 'PUT' });
  if (!newTarget.ok) throw new Error('Could not create a Chrome browser tab.');
  const target = await newTarget.json();
  browser = target;
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.method === 'Network.requestWillBeSent') requestUrls.set(message.params.requestId, message.params.request.url);
    if (message.method === 'Runtime.exceptionThrown') browserLogs.push({ type: 'runtime-exception', text: message.params.exceptionDetails?.text ?? 'Runtime exception' });
    if (message.method === 'Log.entryAdded' && ['error', 'warning'].includes(message.params.entry?.level)) browserLogs.push({ type: 'console', level: message.params.entry.level, text: message.params.entry.text });
    if (message.method === 'Network.loadingFailed') browserLogs.push({ type: 'network-failure', text: message.params.errorText, url: requestUrls.get(message.params.requestId) ?? 'unknown' });
    if (message.method === 'Page.javascriptDialogOpening') {
      void request('Page.handleJavaScriptDialog', { accept: true });
    }
    if (message.id && pending.has(message.id)) {
      const handlers = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) handlers.reject(new Error(`${handlers.method}: ${message.error.message}`));
      else handlers.resolve(message);
    }
  });
  await request('Page.enable');
  await request('Runtime.enable');
  await request('Log.enable');
  await request('Network.enable');
  await request('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await request('Page.navigate', { url: 'http://localhost:5173/' });
  await waitFor("location.pathname === '/' && !!document.querySelector('input[type=email]')", 'registration screen');
  await clickButton('Register');
  await setField('input[type=text]', 'Stage A Browser Owner');
  await setField('input[type=email]', `${emailPrefix}-owner@example.test`);
  await setField('input[type=password]', password);
  await clickButton('Create account');
  await waitFor("location.pathname === '/trips' && document.body.innerText.includes('My trips')", 'owner registration and My Trips');
  let ownerToken = await getToken();
  const owner = await currentUser(ownerToken);
  ownerId = owner.user.id;
  accounts.push({ id: owner.user.id, email: owner.user.email });
  assert(Boolean(ownerToken), 'Browser registration established an authenticated session');

  const tripName = `Stage A Browser ${suffix}`;
  const tripId = await createTripViaUi(tripName, '2027-04-10', '2027-04-14', 'INR');
  await request('Page.navigate', { url: 'http://localhost:5173/trips' });
  await waitFor(`document.body.innerText.includes(${JSON.stringify(tripName)})`, 'created trip listed in My Trips');
  assert((await evaluate('document.body.innerText')).includes('Upcoming trips'), 'My Trips groups the new trip in the dashboard');
  await screenshot('my-trips-desktop.png');
  await request('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await screenshot('my-trips-mobile.png');
  await request('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });

  const secondTripName = `Stage A Browser Second ${suffix}`;
  const secondTripId = await createTripViaUi(secondTripName, '2027-05-01', '2027-05-04', 'USD');
  await request('Page.navigate', { url: 'http://localhost:5173/trips' });
  await waitFor(`document.body.innerText.includes(${JSON.stringify(tripName)}) && document.body.innerText.includes(${JSON.stringify(secondTripName)})`, 'both trips listed');
  await screenshot('my-trips-two-trips.png');
  await request('Page.navigate', { url: `http://localhost:5173/dashboard?tripId=${tripId}` });
  await waitFor("location.pathname === '/dashboard' && !!document.querySelector('#trip-select')", 'first trip in expense dashboard');
  assert(await evaluate(`document.querySelector('#trip-select').value === ${JSON.stringify(tripId)}`), 'Dashboard opens the selected first trip');
  await setField('#trip-select', secondTripId);
  await waitFor(`document.querySelector('#trip-select').value === ${JSON.stringify(secondTripId)}`, 'second trip selected');
  assert(true, 'Trip selector switches to the second trip in the browser');
  await screenshot('trip-switching-second-trip.png');
  await setField('#trip-select', tripId);
  await waitFor(`document.querySelector('#trip-select').value === ${JSON.stringify(tripId)}`, 'switch back to first trip');
  assert(true, 'Trip selector switches back to the first trip');

  const member = await registerAccount(1, 'Stage A Browser Member');
  const secondMember = await registerAccount(2, 'Stage A Browser Direct Add');
  const wrongAccount = await registerAccount(3, 'Stage A Browser Wrong Email');
  const declineAccount = await registerAccount(4, 'Stage A Browser Decline');
  const expiredAccount = await registerAccount(5, 'Stage A Browser Expired');
  await request('Page.navigate', { url: `http://localhost:5173/trips/${tripId}` });
  await waitFor("document.body.innerText.includes('Invite a registered user')", 'owner trip management controls');
  await screenshot('trip-member-management-owner.png');
  await setField('#invite-email', member.user.email);
  await clickButton('Create invitation');
  await waitFor("document.body.innerText.includes('Invitation created')", 'owner invitation confirmation');
  assert((await evaluate('document.body.innerText')).includes(member.user.email), 'Owner sees the pending registered-user invitation');
  const memberInvitation = await prisma.tripInvitation.findFirstOrThrow({ where: { tripId, email: member.user.email, status: 'pending' }, select: { id: true } });
  createdInvitationIds.push(memberInvitation.id);
  const mismatchedAcceptance = await responseStatus(`http://localhost:4000/api/invitations/${memberInvitation.id}/accept`, 'POST', wrongAccount.token, {});
  assert(mismatchedAcceptance === 404, 'Invitation acceptance rejects a different registered account email');
  acceptanceResults.push({ type: 'wrong-email-accept', status: mismatchedAcceptance });

  await login(member.user.email, 'Invited member');
  await waitFor("document.body.innerText.includes('Stage A Browser') && document.body.innerText.includes('Accept')", 'member invitation inbox');
  const emptyTripState = await evaluate('document.body.innerText');
  assert(emptyTripState.includes('No active trips yet') || emptyTripState.includes('Your next trip starts here'), 'New member sees the empty trip state before accepting');
  await screenshot('invitation-inbox.png');
  assert((await evaluate('document.body.innerText')).includes(member.user.email), 'Invitation shows the authenticated matching email');
  await clickButton('Accept');
  await waitFor("document.body.innerText.includes('joined Stage A Browser')", 'invitation acceptance confirmation');
  assert((await evaluate('document.body.innerText')).includes('joined Stage A Browser'), 'Member accepted invitation through the browser');
  await clickButton('Trip members and settings');
  await waitFor(`location.pathname === '/trips/' + ${JSON.stringify(tripId)}`, 'member trip details');
  await waitFor("document.body.innerText.includes('Stage A Browser Owner') && document.body.innerText.includes('Stage A Browser Member')", 'trip member data for invited user');
  let memberPage = await evaluate('document.body.innerText');
  assert(memberPage.includes('Stage A Browser Owner') && memberPage.includes('Stage A Browser Member'), 'Both trip members are visible after acceptance');
  assert(memberPage.includes('available to trip owners and admins'), 'Member account cannot access management controls');
  await screenshot('member-management-readonly.png');
  const memberToken = await getToken();
  const memberCashAssignment = await responseStatus(`http://localhost:4000/api/trips/${tripId}/cash-manager`, 'PATCH', memberToken, { userId: owner.user.id });
  const memberAddAction = await responseStatus(`http://localhost:4000/api/trips/${tripId}/members`, 'POST', memberToken, { email: wrongAccount.user.email, role: 'MEMBER' });
  const memberInvitationList = await responseStatus(`http://localhost:4000/api/trips/${tripId}/invitations`, 'GET', memberToken);
  assert(memberCashAssignment === 403 && memberAddAction === 403 && memberInvitationList === 403, 'Ordinary member is denied cash-manager, member-add, and pending-invitation manager APIs');
  acceptanceResults.push({ type: 'member-management-denied', cashManagerStatus: memberCashAssignment, addMemberStatus: memberAddAction, invitationListStatus: memberInvitationList });

  await login(owner.user.email, 'Trip owner');
  await waitFor("document.body.innerText.includes('Stage A Browser')", 'owner trip dashboard');
  await clickButton('Trip members and settings');
  await waitFor(`location.pathname === '/trips/' + ${JSON.stringify(tripId)}`, 'owner trip management');
  await waitFor("document.body.innerText.includes('Invite a registered user')", 'owner management controls');
  await screenshot('trip-member-management-owner-after-acceptance.png');

  await setField('#invite-email', declineAccount.user.email);
  await clickButton('Create invitation');
  await waitFor("document.body.innerText.includes('Invitation created')", 'decline invitation created');
  const declineInvitation = await prisma.tripInvitation.findFirstOrThrow({ where: { tripId, email: declineAccount.user.email, status: 'pending' }, select: { id: true } });
  createdInvitationIds.push(declineInvitation.id);

  await setField('#invite-email', expiredAccount.user.email);
  await clickButton('Create invitation');
  await waitFor("document.body.innerText.includes('Invitation created')", 'expiring invitation created');
  const expiredInvitation = await prisma.tripInvitation.findFirstOrThrow({ where: { tripId, email: expiredAccount.user.email, status: 'pending' }, select: { id: true } });
  createdInvitationIds.push(expiredInvitation.id);

  await screenshot('manager-pending-invitations.png');
  await login(declineAccount.user.email, 'Declining invitee');
  await waitFor("document.body.innerText.includes('Decline')", 'decline invitation inbox');
  await clickButton('Decline');
  await waitFor("document.body.innerText.toLowerCase().includes('invitation to') && document.body.innerText.toLowerCase().includes('declined')", 'invitation decline confirmation');
  assert((await prisma.tripInvitation.findUniqueOrThrow({ where: { id: declineInvitation.id }, select: { status: true } })).status === 'declined', 'Decline action is persisted');
  acceptanceResults.push({ type: 'decline', status: 'declined' });

  await login(expiredAccount.user.email, 'Expired invitee');
  await waitFor("document.body.innerText.includes('Accept')", 'expiring invitation inbox');
  await screenshot('invitation-before-expiry.png');
  await prisma.tripInvitation.update({ where: { id: expiredInvitation.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await clickButton('Accept');
  await waitFor("document.body.innerText.includes('This invitation has expired.')", 'expired acceptance error state');
  assert((await prisma.tripInvitation.findUniqueOrThrow({ where: { id: expiredInvitation.id }, select: { status: true } })).status === 'expired', 'Expired acceptance is rejected and invitation status becomes expired');
  acceptanceResults.push({ type: 'expired-accept', status: 410 });

  await login(owner.user.email, 'Trip owner');
  await request('Page.navigate', { url: `http://localhost:5173/trips/${tripId}` });
  await waitFor("document.body.innerText.includes('Invite a registered user')", 'owner controls after invitation checks');
  await setField('#member-email', secondMember.user.email);
  await clickButton('Add member');
  await waitFor("document.body.innerText.includes('Registered user added as a member')", 'direct member add confirmation');
  await setField('#cash-manager', member.user.id);
  await clickButton('Update manager');
  await waitFor("document.body.innerText.includes('Cash manager assignment updated')", 'cash manager assignment confirmation');
  assert((await evaluate('document.body.innerText')).includes('Stage A Browser Member'), 'Owner assigned an active trip member as cash manager');
  await screenshot('cash-manager-assigned-to-member.png');
  await setField('#cash-manager', owner.user.id);
  await clickButton('Update manager');
  await waitFor("document.body.innerText.includes('Cash manager assignment updated')", 'cash manager reassignment confirmation');
  assert((await evaluate('document.body.innerText')).includes('Stage A Browser Owner'), 'Owner changed the cash manager assignment');

  const inactiveMembership = await prisma.tripMember.findUniqueOrThrow({ where: { tripId_userId: { tripId, userId: secondMember.user.id } }, select: { id: true, isActive: true } });
  await prisma.tripMember.update({ where: { id: inactiveMembership.id }, data: { isActive: false } });
  const inactiveManagerStatus = await responseStatus(`http://localhost:4000/api/trips/${tripId}/cash-manager`, 'PATCH', ownerToken, { userId: secondMember.user.id });
  assert(inactiveManagerStatus === 404, 'Backend refuses cash-manager assignment to an inactive member');
  acceptanceResults.push({ type: 'inactive-cash-manager-rejected', status: inactiveManagerStatus });

  await setField(`[aria-label="Stage A Browser Member planned budget"]`, '2500.00');
  const saveButtons = await evaluate("[...document.querySelectorAll('button')].filter((button) => button.textContent.includes('Save budget')).length");
  assert(saveButtons >= 2, 'Owner can configure individual member budgets');
  await evaluate("[...document.querySelectorAll('form')].find((form) => form.querySelector('[aria-label=\"Stage A Browser Member planned budget\"]'))?.requestSubmit()");
  await waitFor("document.body.innerText.includes('Member budget saved')", 'budget save confirmation');
  await screenshot('member-budget-before-expense.png');
  const createdExpenseResponse = await fetch(`http://localhost:4000/api/trips/${tripId}/expenses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Browser budget allocation check', amount: '100.00', currency: 'INR', category: 'Food',
      expenseType: 'GROUP', splitMethod: 'EQUAL', paymentMethod: 'CASH', date: new Date().toISOString(),
      splits: [{ userId: owner.user.id }, { userId: member.user.id }],
      payers: [{ userId: owner.user.id, amount: '100.00' }],
    }),
  });
  const createdExpense = await createdExpenseResponse.json();
  assert(createdExpenseResponse.status === 201 && createdExpense.expense.payers[0].amount === '100.00', 'Browser-created expense records a 100.00 payer contribution');
  const budgetResult = await fetch(`http://localhost:4000/api/trips/${tripId}/budgets`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  const budgetPayload = await budgetResult.json();
  const memberBudget = budgetPayload.members.find((entry) => entry.userId === member.user.id);
  assert(memberBudget.responsibility === '50.00' && memberBudget.remainingBudget === '2450.00', 'Budget uses the 50.00 responsibility allocation rather than the 100.00 payer contribution');
  acceptanceResults.push({ type: 'budget-versus-payer', payerContribution: '100.00', responsibility: memberBudget.responsibility, remainingBudget: memberBudget.remainingBudget });
  await request('Page.navigate', { url: `http://localhost:5173/trips/${tripId}` });
  await waitFor("document.body.innerText.includes('2,450.00')", 'recalculated budget visible in browser');
  const ownerPage = await evaluate('document.body.innerText');
  assert(ownerPage.includes('Stage A Browser Direct Add') && ownerPage.includes('2,450.00'), 'Member list shows the added member and recalculated remaining budget');
  await screenshot('member-budget-after-expense.png');

  await request('Page.navigate', { url: `http://localhost:5173/dashboard?tripId=${tripId}` });
  await waitFor("location.pathname === '/dashboard' && !!document.querySelector('#trip-select')", 'expense dashboard trip switcher');
  assert(await evaluate(`document.querySelector('#trip-select').value === ${JSON.stringify(tripId)}`), 'Dashboard opens the trip selected from My Trips');
  await request('Network.setBlockedURLs', { urls: ['*localhost:4000/api/trips*'] });
  await request('Page.navigate', { url: 'http://localhost:5173/trips' });
  await waitFor("document.body.innerText.includes('Failed to fetch')", 'trip list API error state');
  assert(true, 'My Trips displays an API failure without crashing');
  await screenshot('my-trips-error-state.png');
  await request('Network.setBlockedURLs', { urls: [] });
  await request('Page.navigate', { url: 'http://localhost:5173/trips' });
  await waitFor("document.body.innerText.includes('My trips') && !document.body.innerText.includes('Failed to fetch')", 'My Trips recovers after API restored');
  assert(true, 'My Trips recovers after the trip API becomes available again');
}

try {
  await main();
  runStatus = 'passed';
} catch (error) {
  runStatus = 'failed';
  runError = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  let cleanupError = null;
  let cleanedTrips = 0;
  let cleanedUsers = 0;
  let remainingTestFixtures = null;
  try {
    if (tripIds.length && accounts.length) {
      if (!ownerId) throw new Error('Owner fixture ID unavailable; left browser trips untouched.');
      const owned = await prisma.trip.findMany({ where: { id: { in: tripIds }, createdByUserId: ownerId, name: { in: expectedTripNames } }, select: { id: true } });
      if (owned.length !== tripIds.length) throw new Error('Fixture trip ownership check failed; left trip fixtures untouched.');
      const ownedInvitations = await prisma.tripInvitation.findMany({ where: { id: { in: createdInvitationIds }, tripId: { in: owned.map((trip) => trip.id) } }, select: { id: true } });
      if (ownedInvitations.length !== createdInvitationIds.length) throw new Error('Fixture invitation ownership check failed; left invitation fixtures untouched.');
      for (const ownedTrip of owned) {
        await prisma.financialEntry.deleteMany({ where: { tripId: ownedTrip.id, reversalOfId: { not: null } } });
        await prisma.financialEntry.deleteMany({ where: { tripId: ownedTrip.id } });
        await prisma.expense.deleteMany({ where: { tripId: ownedTrip.id, correctedFromExpenseId: { not: null } } });
        await prisma.expense.deleteMany({ where: { tripId: ownedTrip.id } });
      }
      const deleted = await prisma.trip.deleteMany({ where: { id: { in: owned.map((trip) => trip.id) }, createdByUserId: ownerId, name: { in: expectedTripNames } } });
      cleanedTrips = deleted.count;
    }
    if (accounts.length) {
      const ownedUsers = await prisma.user.findMany({ where: { id: { in: accounts.map((account) => account.id) }, email: { startsWith: emailPrefix } }, select: { id: true } });
      if (ownedUsers.length !== accounts.length) throw new Error('Fixture account ownership check failed; left account fixtures untouched.');
      const deleted = await prisma.user.deleteMany({ where: { id: { in: ownedUsers.map((user) => user.id) }, email: { startsWith: emailPrefix } } });
      cleanedUsers = deleted.count;
    }
    const [remainingUsers, remainingTrips] = await Promise.all([
      prisma.user.count({ where: { email: { startsWith: emailPrefix } } }),
      prisma.trip.count({ where: { name: { in: expectedTripNames } } }),
    ]);
    remainingTestFixtures = { users: remainingUsers, trips: remainingTrips };
    finalIntegrityHash = await integrityHash();
  } catch (error) {
    cleanupError = error instanceof Error ? error.message : String(error);
    runStatus = 'cleanup-review-required';
  }
  const report = {
    status: runStatus,
    error: runError,
    cleanupError,
    checks,
    invitationAndAuthorizationResults: acceptanceResults,
    screenshots,
    logs: browserLogs,
    fixtures: { tripIds, invitationIds: createdInvitationIds, accountIds: accounts.map((account) => account.id), cleanedTrips, cleanedUsers, remaining: remainingTestFixtures },
    existingTripAndUserRecordSnapshotUnchanged: baselineIntegrityHash === finalIntegrityHash,
  };
  writeFileSync(join(artifactDirectory, 'browser-verification.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(artifactDirectory, 'browser-logs.json'), JSON.stringify(browserLogs, null, 2));
  copyFileSync(fileURLToPath(import.meta.url), join(artifactDirectory, 'verify-onboarding.mjs'));
  console.log(JSON.stringify({ ...report, artifactDirectory: basename(artifactDirectory) }));
  if (ws?.readyState === WebSocket.OPEN) ws.close();
  if (browser?.id) await fetch(`http://127.0.0.1:9223/json/close/${browser.id}`).catch(() => undefined);
  await prisma.$disconnect();
  if (cleanupError) throw new Error(cleanupError);
}

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/components/ui/auth-switch.tsx'), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Test our routing and integration boundary without contacting Clerk or sending
// real emails. Clerk's forms own password recovery, verification and MFA.
function portal({ url = 'https://app.example/connexion', props = {}, historyState = null,
  auth = { isLoaded: true, isSignedIn: false } } = {}) {
  const hooks = [];
  const listeners = new Map();
  const redirects = [];
  let cursor = 0;
  let effects = [];
  let currentAuth = auth;
  const location = new URL(url);
  location.replace = (target) => { redirects.push(target); location.href = new URL(target, location).href; };
  location.reload = () => {};
  const history = {
    state: historyState,
    replaceState(state, _unused, target) {
      this.state = state;
      location.href = new URL(target, location).href;
    },
  };
  const jsx = (type, nodeProps, key) => ({ type, props: nodeProps, key });
  const exports = {};
  vm.runInNewContext(code, {
    exports, URL, URLSearchParams,
    window: {
      location, history,
      setTimeout, clearTimeout,
      addEventListener(name, handler) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(handler);
      },
      removeEventListener(name, handler) { listeners.get(name)?.delete(handler); },
    },
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return {
        useState(initial) {
          const index = cursor++;
          if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
          return [hooks[index], (next) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }];
        },
        useRef(initial) {
          const index = cursor++;
          return hooks[index] ??= { current: initial };
        },
        useEffect(effect, deps) {
          const index = cursor++;
          const previous = hooks[index];
          if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
            effects.push(() => {
              previous?.cleanup?.();
              hooks[index] = { deps, cleanup: effect() };
            });
          }
        },
      };
      if (name === '@clerk/clerk-react') return {
        useAuth: () => currentAuth,
        SignIn: 'ClerkSignIn', SignUp: 'ClerkSignUp',
        ClerkLoaded: 'ClerkLoaded', ClerkLoading: 'ClerkLoading', ClerkFailed: 'ClerkFailed',
      };
      if (name === 'lucide-react') return { ArrowLeft: 'ArrowLeft', Loader2: 'Loader2' };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  function render() {
    cursor = 0;
    effects = [];
    const tree = exports.AuthSwitch(props);
    effects.forEach(effect => effect());
    return tree;
  }
  function nodes(node, result = []) {
    if (Array.isArray(node)) { node.forEach(child => nodes(child, result)); return result; }
    if (!node || typeof node !== 'object') return result;
    result.push(node);
    nodes(node.props?.children, result);
    return result;
  }
  return {
    authReturnUrl: exports.authReturnUrl,
    location, history, redirects,
    all: () => nodes(render()),
    find: predicate => nodes(render()).find(predicate),
    form: () => {
      const forms = nodes(render()).filter(node => node.type === 'ClerkSignIn' || node.type === 'ClerkSignUp');
      assert.equal(forms.length, 1, 'exactly one Clerk authentication form must be mounted');
      return forms[0];
    },
    navigate(target, event) {
      location.href = new URL(target, location).href;
      for (const handler of listeners.get(event) ?? []) handler();
    },
    setAuth(next) { currentAuth = next; render(); },
  };
}

test('return URLs reject other origins, executable schemes and credential-bearing URLs', () => {
  const { authReturnUrl } = portal();
  const origin = 'https://app.example';
  for (const value of [
    'https://other.example/account', '//other.example/account', '\\\\other.example/account',
    'http://app.example/account', 'https://app.example:8443/account',
    'https://app.example.other.example/account', 'https://app.example@other.example/account',
    'https://user:password@app.example/account', 'javascript:alert(1)', 'data:text/html,test',
    'https://app.example//other.example/account', '/.//other.example/account',
    'https://app.example///other.example/account',
    'https://[invalid',
  ]) assert.equal(authReturnUrl(value, origin), '/', value);
});

test('return URLs remove portal parameters and preserve local destination, filters and anchor', () => {
  const { authReturnUrl } = portal();
  for (const [value, expected] of [
    [undefined, '/'], [null, '/'], ['', '/'],
    ['/clients/123?tab=ventes#factures', '/clients/123?tab=ventes#factures'],
    ['https://app.example/clients?tab=ventes#factures', '/clients?tab=ventes#factures'],
    ['/clients?auth=signup&tab=ventes&redirect_url=%2Finscription#factures', '/clients?tab=ventes#factures'],
    ['/?auth=signin&redirect_url=%2F', '/'],
    ['/connexion-aide', '/connexion-aide'],
  ]) assert.equal(authReturnUrl(value, 'https://app.example'), expected, String(value));
});

test('return URLs cannot loop back into an authentication route or one of its steps', () => {
  const { authReturnUrl } = portal();
  for (const route of ['connexion', 'inscription', 'sign-in', 'sign-up', 'Connexion', '%63onnexion', '%69nscription']) {
    for (const suffix of ['', '/', '/verify', '?redirect_url=%2Fclients', '#/factor-one']) {
      assert.equal(authReturnUrl(`/${route}${suffix}`, 'https://app.example'), '/', `${route}${suffix}`);
    }
  }
});

test('sign-in delegates recovery and verification to one Clerk form with safe completion URLs', () => {
  const ui = portal({ url: 'https://app.example/connexion?redirect_url=%2Fclients%3Ftab%3Dventes' });
  const form = ui.form();
  assert.equal(form.type, 'ClerkSignIn');
  assert.equal(form.props.routing, 'hash');
  assert.equal(form.props.withSignUp, false);
  assert.equal(form.props.forceRedirectUrl, '/clients?tab=ventes');
  assert.equal(form.props.signUpForceRedirectUrl, '/clients?tab=ventes');
  const signUpUrl = new URL(form.props.signUpUrl, ui.location);
  assert.equal(signUpUrl.pathname, '/connexion');
  assert.equal(signUpUrl.searchParams.get('auth'), 'signup');
  assert.equal(signUpUrl.searchParams.get('redirect_url'), '/clients?tab=ventes');
  assert.equal(signUpUrl.hash, '');
  assert.equal(ui.all().some(node => node.type === 'form' || node.type === 'input'), false);
});

test('signup reload on any app entry route overrides initial mode and configures a local sign-in link', () => {
  for (const pathname of ['/', '/connexion', '/inscription']) {
    const ui = portal({ url: `https://app.example${pathname}?auth=signup&redirect_url=%2Fclients#/verify-email-address`,
      props: { initialMode: 'signin' } });
    const form = ui.form();
    assert.equal(form.type, 'ClerkSignUp');
    assert.equal(form.props.routing, 'hash');
    assert.equal(form.props.forceRedirectUrl, '/clients');
    assert.equal(form.props.signInForceRedirectUrl, '/clients');
    const signInUrl = new URL(form.props.signInUrl, ui.location);
    assert.equal(signInUrl.pathname, pathname);
    assert.equal(signInUrl.searchParams.get('auth'), 'signin');
    assert.equal(signInUrl.searchParams.get('redirect_url'), '/clients');
    assert.equal(signInUrl.hash, '');
  }
});

test('explicit sign-in mode takes priority on inscription route; invalid modes use the app default', () => {
  assert.equal(portal({ url: 'https://app.example/inscription?auth=signin', props: { initialMode: 'signup' } }).form().type, 'ClerkSignIn');
  assert.equal(portal({ url: 'https://app.example/inscription?auth=invalid', props: { initialMode: 'signup' } }).form().type, 'ClerkSignUp');
});

test('explicit return prop takes priority, and unsafe destinations never reach Clerk or mode links', () => {
  const explicit = portal({ url: 'https://app.example/connexion?redirect_url=%2Fignored', props: { redirectUrl: '/commandes?status=open' } });
  assert.equal(explicit.form().props.forceRedirectUrl, '/commandes?status=open');
  for (const initialMode of ['signin', 'signup']) {
    const ui = portal({ props: { initialMode, redirectUrl: 'https://other.example/steal' } });
    const form = ui.form();
    assert.equal(form.props.forceRedirectUrl, '/');
    assert.equal(form.props.signInForceRedirectUrl ?? form.props.signUpForceRedirectUrl, '/');
    const modeUrl = new URL(form.props.signInUrl ?? form.props.signUpUrl, ui.location);
    assert.equal(modeUrl.origin, 'https://app.example');
    assert.equal(modeUrl.searchParams.get('redirect_url'), '/');
  }
});

test('apps that display the portal at a protected destination return to that page with its filters', () => {
  const ui = portal({ url: 'https://app.example/clients?tab=ventes&auth=signin#/factor-two' });
  assert.equal(ui.form().props.forceRedirectUrl, '/clients?tab=ventes');
  ui.find(node => node.type === 'button' && node.props.children === 'Créer un compte').props.onClick();
  assert.equal(ui.form().props.forceRedirectUrl, '/clients?tab=ventes');
  assert.equal(ui.location.searchParams.get('redirect_url'), '/clients?tab=ventes');
});

test('switching modes clears the old verification hash, keeps app history state and works without a router', () => {
  const historyState = { idx: 3, key: 'route-key', usr: { from: '/clients' } };
  const ui = portal({ url: 'https://app.example/?redirect_url=%2Fclients&campaign=septembre#/factor-two', historyState });
  assert.equal(ui.form().type, 'ClerkSignIn');
  ui.find(node => node.type === 'button' && node.props.children === 'Créer un compte').props.onClick();
  assert.equal(ui.form().type, 'ClerkSignUp');
  assert.equal(ui.location.pathname, '/');
  assert.equal(ui.location.hash, '');
  assert.equal(ui.location.searchParams.get('auth'), 'signup');
  assert.equal(ui.location.searchParams.get('redirect_url'), '/clients');
  assert.equal(ui.location.searchParams.get('campaign'), 'septembre');
  assert.equal(ui.history.state, historyState);
  ui.find(node => node.type === 'button' && node.props.children === 'Se connecter').props.onClick();
  assert.equal(ui.form().type, 'ClerkSignIn');
  assert.equal(ui.location.searchParams.get('auth'), 'signin');
  assert.equal(ui.history.state, historyState);
});

test('hash steps keep the same Clerk component and browser navigation updates the selected mode', () => {
  const ui = portal({ url: 'https://app.example/connexion?redirect_url=%2Fclients' });
  const entry = ui.form();
  assert.equal(ui.all().some(node => node.type === 'h1'), true);
  ui.navigate('#/forgot-password', 'hashchange');
  const recovery = ui.form();
  assert.equal(recovery.type, entry.type);
  assert.equal(recovery.key, entry.key);
  assert.equal(recovery.props.forceRedirectUrl, '/clients');
  assert.equal(ui.all().some(node => node.type === 'h1'), false, 'step headings belong to Clerk');
  ui.navigate('/connexion?auth=signup&redirect_url=%2Fclients#/verify-email-address', 'popstate');
  assert.equal(ui.form().type, 'ClerkSignUp');
  ui.navigate('/connexion?auth=signin&redirect_url=%2Fclients', 'popstate');
  assert.equal(ui.form().type, 'ClerkSignIn');
  assert.equal(ui.all().some(node => node.type === 'h1'), true);
});

test('Clerk loading and failure states provide fallback components', () => {
  const ui = portal();
  for (const state of ['ClerkLoading', 'ClerkFailed']) {
    assert.ok(ui.find(node => node.type === state)?.props.children, state);
  }
  assert.ok(ui.form().props.fallback);
});

test('session loading does not redirect; an already signed-in visitor returns safely after loading', () => {
  const ui = portal({ url: 'https://app.example/connexion?redirect_url=%2Fclients%3Ftab%3Dventes',
    auth: { isLoaded: false, isSignedIn: undefined } });
  ui.all();
  assert.deepEqual(ui.redirects, []);
  ui.setAuth({ isLoaded: true, isSignedIn: true });
  assert.deepEqual(ui.redirects, ['/clients?tab=ventes']);
});

test('a signed-in visitor cannot be redirected to an external site or back to the portal', () => {
  for (const target of ['https://other.example/steal', '/connexion', '/inscription#/verify']) {
    const ui = portal({ url: `https://app.example/connexion?redirect_url=${encodeURIComponent(target)}`,
      auth: { isLoaded: true, isSignedIn: true } });
    ui.all();
    assert.deepEqual(ui.redirects, ['/'], target);
  }
});

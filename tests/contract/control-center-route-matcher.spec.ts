import { matchControlCenterRoute } from '../../apps/control-center/src/route-matcher';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function main(): void {
  const onboarding = matchControlCenterRoute('/onboarding');
  assert(onboarding?.route === '/onboarding', 'Exact static route matches');
  assert(Object.keys(onboarding?.params ?? {}).length === 0, 'Static route has no params');

  const conversation = matchControlCenterRoute('/conversations/abc-123');
  assert(conversation?.route === '/conversations/:id', 'Dynamic segment matches its route template');
  assert(conversation?.params.id === 'abc-123', 'Dynamic param value is captured');

  const trailingSlash = matchControlCenterRoute('/onboarding/');
  assert(trailingSlash?.route === '/onboarding', 'Trailing slash is tolerated');

  const rootOnly = matchControlCenterRoute('/');
  assert(rootOnly === null, 'Root path with no matching route returns null, not a guessed default');

  const unknown = matchControlCenterRoute('/does-not-exist');
  assert(unknown === null, 'Unknown path returns null rather than a fabricated match');

  const wrongArity = matchControlCenterRoute('/conversations');
  assert(wrongArity === null, 'A path missing the required dynamic segment does not match');

  const emptyDynamicSegment = matchControlCenterRoute('/conversations/');
  assert(emptyDynamicSegment === null, 'An empty dynamic segment value is rejected, not captured as ""');

  const allStaticRoutes = ['/inbox', '/rules', '/approvals', '/integrations', '/audit', '/usage'] as const;
  for (const route of allStaticRoutes) {
    const matched = matchControlCenterRoute(route);
    assert(matched?.route === route, `${route} matches itself exactly`);
  }

  console.log('control-center-route-matcher: 14/14 PASS');
}

main();

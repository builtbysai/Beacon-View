# Testing policy

Tests are a safety mechanism, not a deliverable or a measure of productivity.
The goal is high confidence with the smallest useful suite. Do not automatically
create tests for each file, component, helper, function, or code path.

Before adding a test, identify the realistic regression it would catch. If there
is no clear answer, do not add it. A production code change alone is not a reason
to create a unit test.

## Behaviors to protect

Prioritize authentication and authorization; security and privacy boundaries;
pairing and credential lifecycle; credential/session revocation; account and
household isolation; database persistence and migrations; recording integrity,
encryption and retention; privacy mode stopping capture; WebRTC, signaling and
session transitions; reconnect and recovery; rate limiting; important background
jobs; actual bugs that could recur; and critical workflows spanning components.

Prefer integration tests at real boundaries over many tiny mocked unit tests.
Whenever practical, critical backend tests exercise the real route, authorization,
business logic, and test database. Mock external boundaries when necessary, but
do not mock away the application until the test verifies an imaginary Beacon.

Use unit tests primarily for non-trivial pure logic, state machines, parsing,
algorithms, edge cases, and security-sensitive transformations. Maintain a small
set of end-to-end tests for critical workflows.

## Tests generally not worth creating

Do not test trivial getters/setters, constants, simple object construction,
TypeScript behavior enforced by the compiler, framework behavior, basic React
rendering without meaningful behavior, or one-line wrappers and passthroughs.
Avoid exact copy unless functionally important, brittle markup/CSS assertions,
private implementation details, every conditional for coverage, snapshots merely
because a component exists, mocks confirming their configured return values,
internal call order unless contractual, and behavior already adequately covered
by a stronger test.

## Bugs and UI validation

Add a regression test only when the actual bug can be represented meaningfully
and deterministically. It must fail because of the bug and pass because of the
fix. Do not manufacture unit tests for visual, hardware, browser, camera, or
real-device bugs. Use appropriate manual, device, or integration validation and
document what was tested.

Do not test every React component. Test meaningful interaction and state, favoring
complete workflows: pair a device, see it, open the camera; enable privacy, stop
capture, update the viewer; record an event and access the clip; revoke a device
and deny subsequent access. Avoid large exact-markup assertions. Validate visual
appearance primarily in actual browsers/devices.

## Suite maintenance and coverage

Tests have maintenance cost. When touching an area, review nearby tests. Delete
or merge obsolete, redundant, duplicated, permanently skipped, excessively mocked,
implementation-detail tests, and those superseded by stronger integration tests
or no longer protecting meaningful behavior. Deleting low-value tests improves
the suite. Do not retain tests solely to preserve a coverage percentage.

Do not target 100% coverage or generate tests to increase a percentage. Untested
trivial code is preferable to meaningless tests. Critical security and lifecycle
paths should have strong protection even when overall coverage is lower.

## Before writing a test

1. Search for existing coverage.
2. Identify the realistic failure the proposed test detects.
3. Choose the highest useful level, preferring integration when practical.
4. Avoid duplicating another test.
5. Write the minimum test necessary to protect the behavior.

If the test does not materially increase confidence in Beacon, do not write it.

## Completion reports

Report tests added, modified, deleted or merged and why; relevant automated checks
run; and actual browser, device, or manual validation performed. State limitations
honestly. Do not cite test count or coverage percentage as evidence of correctness.

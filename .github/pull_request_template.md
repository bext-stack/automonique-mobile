## Change

Describe the user-visible outcome and the authority or safety boundary affected.

## Verification

- [ ] `npm run validate`
- [ ] Native transport policy verification passes when native configuration changes
- [ ] Tests cover failure, stale, ambiguous, and unauthorized states where relevant
- [ ] Third-party notices are regenerated when production dependencies change
- [ ] No credentials, customer data, private endpoints, or signing material are included
- [ ] Release and rollback impact is documented, or this change cannot affect a release

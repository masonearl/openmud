# HeavyBid Local Artifacts

This folder is reserved for private HeavyBid extraction outputs generated on the local machine.

The extraction pipeline writes JSON artifacts into these subfolders:

- `schema/`
- `manifests/`
- `normalized/`
- `binary/`

Those generated files are ignored by git on purpose so private bid history, rates, and estimator data do not get committed accidentally.

# Link2AI signup-default fix

Focused onboarding patch only.

- New unauthenticated users now land on **Create your Link2AI account** instead of the sign-in page.
- Existing users can still choose **Sign in** from the signup page.
- OAuth and billing entry points use `/signup` as the default unauthenticated destination.
- No billing, quota, OAuth token, trial, worker, resolver, or plan logic was changed.

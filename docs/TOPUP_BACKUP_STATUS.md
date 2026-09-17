# Top-up + backup activation status

The code in this branch intentionally keeps both new capabilities fail-closed until their external infrastructure is configured.

## Top-up

Top-up UI and checkout remain hidden until both Lemon Squeezy one-time variant IDs are configured:

- `LEMONSQUEEZY_TOPUP_500_VARIANT_ID` for **+500 units / US$3.99**
- `LEMONSQUEEZY_TOPUP_1500_VARIANT_ID` for **+1,500 units / US$8.99**

The existing Lemon Squeezy store/API/webhook configuration is also required. Webhooks must deliver `order_created` and `order_refunded`.

## Offsite backup

Scheduled offsite backup jobs remain skipped until the GitHub repository variable `OFFSITE_BACKUP_ENABLED=true` is set. Before enabling it, configure every secret listed in `BACKUP_RUNBOOK.md` and use an Object-Lock-enabled bucket with COMPLIANCE retention.

A manual workflow dispatch intentionally bypasses the enable flag so configuration can be tested; it fails closed if required secrets are missing or Object Lock is not verified.

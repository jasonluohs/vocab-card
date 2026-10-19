#!/bin/sh
# certbot manual auth hook: expose the challenge value, then wait
# (up to 20 min) until the TXT record shows up in public DNS.
echo "$CERTBOT_VALIDATION" > /opt/acme/current-value.txt
for i in $(seq 1 120); do
  got=$(python3 /opt/acme/readtxt.py "_acme-challenge.$CERTBOT_DOMAIN" 2>/dev/null | head -1)
  if [ "$got" = "$CERTBOT_VALIDATION" ]; then
    exit 0
  fi
  sleep 10
done
exit 1

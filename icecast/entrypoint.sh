#!/bin/sh
# fills the ${...} password placeholders in the mounted config template
# from the environment
set -eu

envsubst '${ICECAST_SOURCE_PASSWORD} ${ICECAST_RELAY_PASSWORD} ${ICECAST_ADMIN_PASSWORD}' \
  < /etc/icecast2/icecast.xml.tpl > /tmp/icecast.xml

exec icecast2 -c /tmp/icecast.xml

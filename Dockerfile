FROM caddy:2.10
# This app listens on 8080 and drops all capabilities at runtime.
RUN setcap -r /usr/bin/caddy
COPY deploy/Caddyfile.app /etc/caddy/Caddyfile
COPY dist/ /srv/
EXPOSE 8080

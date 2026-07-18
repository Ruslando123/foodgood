FROM alpine:3.22

RUN apk add --no-cache pgbouncer postgresql-client su-exec \
    && addgroup -S pooler \
    && adduser -S -D -H -G pooler pooler \
    && mkdir -p /run/pgbouncer \
    && chown pooler:pooler /run/pgbouncer

COPY pgbouncer.ini /etc/pgbouncer/pgbouncer.ini
COPY entrypoint.sh /usr/local/bin/foodgood-pgbouncer
RUN chmod 0555 /usr/local/bin/foodgood-pgbouncer \
    && chmod 0444 /etc/pgbouncer/pgbouncer.ini

EXPOSE 6432
ENTRYPOINT ["/usr/local/bin/foodgood-pgbouncer"]

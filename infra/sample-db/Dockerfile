FROM postgres:18-alpine

USER root
RUN apk add --no-cache openssl
COPY entrypoint-ssl.sh /usr/local/bin/entrypoint-ssl.sh
RUN chmod 755 /usr/local/bin/entrypoint-ssl.sh

ENTRYPOINT ["entrypoint-ssl.sh"]
CMD ["postgres"]

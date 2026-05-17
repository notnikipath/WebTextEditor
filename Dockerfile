FROM nginx:1.27-alpine

WORKDIR /usr/share/nginx/html

COPY src/ ./
COPY resources/ ./resources/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

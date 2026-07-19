FROM node:22-alpine AS build

ARG VITE_ENABLE_MOCK=false
ENV VITE_ENABLE_MOCK=$VITE_ENABLE_MOCK

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

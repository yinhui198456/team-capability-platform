FROM python:3.12-slim AS base

WORKDIR /app
ENV PYTHONPATH=/app

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY capability-model ./capability-model
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM base AS test
COPY backend/requirements-dev.txt ./requirements-dev.txt
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY backend/tests ./tests
CMD ["pytest", "tests", "-q"]

FROM base

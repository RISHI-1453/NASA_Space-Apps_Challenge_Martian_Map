# Martian Map in one container: the FastAPI server and the web app together. Listens on $PORT
# (Google Cloud Run and Azure Container Apps set it), else 7860.
FROM python:3.12-slim

# Spaces run the container as user 1000, and the app writes its tile caches under data/
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH PYTHONUNBUFFERED=1
WORKDIR /home/user/app

COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

COPY --chown=user . .
# the elevation data (MOLA grid, Jezero and Gale DTMs, ~60 MB) goes into the image, so a restart is quick
RUN python scripts/fetch_data.py

EXPOSE 7860
CMD uvicorn app:app --host 0.0.0.0 --port ${PORT:-7860} --app-dir backend --proxy-headers --forwarded-allow-ips "*"

FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV HOST=0.0.0.0 PORT=8000 RELOAD=0
EXPOSE 8000
# Seed fictional demo data on an empty database unless SEED_DEMO=0.
CMD ["sh", "-c", "if [ \"${SEED_DEMO:-1}\" = \"1\" ]; then python seed_demo.py; fi && python app.py"]

# Multi-stage Dockerfile for the Spring Boot CEITBA API.

# ---------- build ----------
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app

# Cache dependencies layer first.
COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
RUN chmod +x mvnw && ./mvnw -B -ntp dependency:go-offline

# Then sources.
COPY src/ src/
RUN ./mvnw -B -ntp -DskipTests package && \
    cp target/*.jar app.jar

# ---------- runtime ----------
FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app

RUN groupadd -r ceitba && useradd -r -g ceitba ceitba

COPY --from=build --chown=ceitba:ceitba /app/app.jar /app/app.jar

USER ceitba
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD wget -qO- http://localhost:8080/api/actuator/health || exit 1

ENTRYPOINT ["java", "-jar", "/app/app.jar"]

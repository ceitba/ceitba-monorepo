@REM ----------------------------------------------------------------------------
@REM Apache Maven Wrapper startup batch script, version 3.3.2
@REM Required ENV vars: JAVA_HOME (must point to a JDK 21 install)
@REM ----------------------------------------------------------------------------
@echo off

setlocal

set DIR=%~dp0
set WRAPPER_JAR=%DIR%.mvn\wrapper\maven-wrapper.jar
set WRAPPER_PROPS=%DIR%.mvn\wrapper\maven-wrapper.properties

if defined JAVA_HOME (
  set "JAVA_EXE=%JAVA_HOME%\bin\java.exe"
) else (
  set "JAVA_EXE=java"
)

if not exist "%WRAPPER_JAR%" (
  for /f "tokens=2 delims==" %%A in ('findstr "^wrapperUrl=" "%WRAPPER_PROPS%"') do set WRAPPER_URL=%%A
  echo Downloading Maven Wrapper from %WRAPPER_URL%
  powershell -Command "Invoke-WebRequest -Uri '%WRAPPER_URL%' -OutFile '%WRAPPER_JAR%'"
)

"%JAVA_EXE%" -classpath "%WRAPPER_JAR%" "-Dmaven.multiModuleProjectDirectory=%DIR%" org.apache.maven.wrapper.MavenWrapperMain %*

# Cobertura de las líneas añadidas en StudyMatch

Medición del 18 de noviembre de 2026. `diff-cover` compara el código del fork con `ff495ba6fc9214b2376aba0429fe4c8a3b52c136`, el último commit que comparte con el repositorio original. Usa los reportes unitarios de coverage.py para Python y Vitest para JavaScript y JSX.

| Código ejecutable añadido o modificado | Líneas cubiertas | Líneas medidas | Sin cobertura unitaria |
| --- | ---: | ---: | ---: |
| Backend | 894 | 894 | 0 |
| Frontend | 482 | 482 | 0 |
| **Total** | **1376** | **1376** | **0** |

`diff-cover` muestra **100 %** para el total. La métrica se calcula a partir de las suites unitarias sobre las líneas ejecutables del producto añadidas o modificadas en el fork. CSS, documentación y archivos de pruebas quedan fuera de ese cálculo. Las pruebas E2E comprueban los flujos completos en Chromium y tienen su propio reporte.

Las suites incluyen **105 pruebas del backend, 54 del frontend y 40 E2E en Chromium**. La suite E2E arranca FastAPI y Vite sobre una base PostgreSQL 17 nueva.

El [README](../README.md#pruebas-automáticas-y-cobertura) contiene el comando para regenerar el reporte. [GitHub Actions](https://github.com/BrayanG123/2do_Proyeccto_IHC/actions/workflows/pruebas.yml?query=branch%3Amain) comprueba el 100 % y publica el resultado en el resumen de cada ejecución y en el artefacto **reportes-pruebas-y-cobertura**. El archivo `diff.html` desglosa los resultados por archivo.

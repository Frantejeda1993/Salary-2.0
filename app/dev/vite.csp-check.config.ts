// Solo para comprobar la CSP: build del modo prueba con la CSP de producción (no se publica).
import { defineConfig, mergeConfig } from "vite";
import mock from "./vite.mock.config";
import { cspPlugin } from "../csp";
export default mergeConfig(mock, defineConfig({ base: "/Salary-2.0/", plugins: [cspPlugin()], build: { outDir: process.env.CSP_OUT ?? "dist-csp" } }));

import { ApolloClient, InMemoryCache, createHttpLink } from '@apollo/client';

// La URL del backend se configura vía variable de entorno de Vite.
// Por defecto usa una ruta RELATIVA `/graphql`, que se resuelve al
// mismo origen del frontend:
//   • `pnpm dev`  → Vite proxy → http://localhost:5173/graphql → backend 3000
//   • Docker      → http://localhost:80/graphql → nginx → backend:3000
//   • Producción  → define VITE_API_URL=https://api.tu-dominio.com/graphql
// Esto evita problemas de CORS y DNS con hostname `backend` desde el browser.
const apiUrl =
  (import.meta.env.VITE_API_URL as string | undefined) ?? '/graphql';

const httpLink = createHttpLink({
  uri: apiUrl,
});

// Sin `defaultOptions` global. Los hooks (`useEnergyData`, `useFronteraData`,
// y cualquier futuro `useXxxData`) declaran `errorPolicy: 'all'` localmente
// para que `<*ErrorState>` se renderice cuando el resolver falla. Cualquier
// defaultOptions aquí es dead-config: los hooks siempre lo override.
const client = new ApolloClient({
  link: httpLink,
  cache: new InMemoryCache(),
});

export default client;
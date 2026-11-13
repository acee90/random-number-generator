# Jeommechu · 점메추

A lunch draw service with shared roulette rooms and real-time chat, plus custom integer draws, Lotto 6/45 and Pension Lottery 720+ tools. The service brand is **점메추 (jeommechu.dev)**. Built with TanStack Start, React and Cloudflare Workers.

# Getting Started

To run this application:

```bash
npm install
```

Copy `.env.example` to `.env.local`, then enter your API keys:

```powershell
Copy-Item .env.example .env.local
```

- `ANU_API_KEY`: ANU Quantum Numbers key from https://quantumnumbers.anu.edu.au/. Without a key, ANU is skipped.
- `RANDOM_ORG_API_KEY`: Optional key from https://api.random.org/api-keys. When set, the server uses the JSON-RPC API; otherwise it uses the public HTTP API.
- `RANDOM_ORG_HASHED_API_KEY`: Optional legacy setting, currently unused for random-number requests.

Start the local app at http://localhost:3000:

```bash
npm run dev
```

Keys are read only by the server. `.env.local` is ignored by Git. Use either `.env.local` or `.dev.vars`; `.dev.vars` takes precedence. Restart the development server after changing keys. Every generation request fetches fresh entropy: ANU first, then Random.org, then server Web Crypto if both are unavailable. Rejection sampling removes range-conversion bias, and the result identifies mixed sources when applicable. The legacy KV pool is diagnostic only and is never consumed by draws. No Cloudflare API token is required for local development.

## Service structure

- `/`: create a lunch room with a room name and nickname.
- `/lunch-room/<UUID>`: shared roulette/results, candidates below the draw, chat, nickname editing and explicit expiry time. Existing invitation URLs remain valid.
- `/tools?tool=number|lotto|pension`: retained direct-entry tools, hidden from the lunch-only navigation and search indexes.
- `/solo`: independent lunch roulette; `/lunch` redirects to `/`.
- Rooms expire 24 hours after creation. Leaving or reconnecting does not shorten or extend that period.

Development plans and progress are tracked in the [GitHub roadmap #7](https://github.com/acee90/random-number-generator/issues/7), which links all nine follow-up tasks and their completion criteria. New plans belong in GitHub Issues; local documents such as [the IA and lifecycle design](docs/jeommechu-ia-plan.md) provide supporting detail. Public/private rooms, custom menu permissions and vote weighting remain in #3–#5. Latest release verification and jeommechu.dev activation are tracked separately in [#8](https://github.com/acee90/random-number-generator/issues/8).

## Features

- Custom integer ranges, 1–100 results, optional duplicates and sorting.
- Lotto 6/45: 1–5 distinct combinations, with standard random selection, disjoint numbers across games, or 1–5 fixed numbers shared by every game. Excluded numbers apply to every strategy; insufficient candidate pools are rejected before requesting entropy. Results and history retain fixed/excluded numbers and the draw strategy.
- Pension Lottery 720+: 1–5 distinct tickets, random or fixed group (1–5), with six digits including leading zeroes.
- Copy results, per-tool history (50 records shared across tools), and undo history deletion. Settings and history stay in browser local storage, with migration from the previous cookie format.
- Responsive desktop/mobile layout with keyboard support and reduced-motion preferences.
- Solo lunch roulette at `/solo`: 107 restaurants and 11 categories from the supplied company-nearby spreadsheet, independent category selection and exclusions, a large labelled wheel with a 7.2-second spin, a result card, and browser history for the last 20 completed draws. Candidates and history open on demand; results and history can be copied individually. Draws use the existing entropy service and show their actual source and time. Distances are the spreadsheet's company-based values, not live device distances; an unknown distance is omitted.
- Live lunch rooms: create a room directly from `/`, then adjust its candidates, share its invitation URL, chat, and watch the host's shared draw. Rooms last 24 hours with up to 30 participants, the last 100 chat/system messages and 20 completed draws. Chat aligns your messages to the right and others to the left. Completed draws retain their candidate/probability/participant snapshot, request and draw times, source and round ID; legacy records retain unknown fields without inventing participants. PartyServer (the official successor to PartyKit hosting) and PartySocket run on Cloudflare Durable Objects in this Worker's account. See [room behavior, local testing and deployment](docs/lunch-rooms.md). Custom lists, Excel upload/export and place search remain in [the phased development plan](docs/lunch-plan.md).

Lottery generation follows the formats documented by [Donghaeng Lottery](https://www.dhlottery.co.kr/). This tool generates number selections; it does not predict winning numbers or purchase tickets.

# Building For Production

To build this application for production:

```bash
npm run build
```

## Analytics

Google Tag Manager container `GTM-PH7KTBC8` is installed in the shared document head for all routes. It loads only in production builds (`npm run build`, including local production previews); `npm run dev` does not load it.

To collect GA4 data for `https://jeommechu.dev`, configure a Google tag with the GA4 measurement ID in this GTM container and publish it. The container installation alone does not configure a GA4 destination. After deploying the site, verify the published tag with Tag Assistant and GA4 Realtime.

## Testing

This project uses [Vitest](https://vitest.dev/) for testing. You can run the tests with:

```bash
npm run test
```

## Styling

This project uses [Tailwind CSS](https://tailwindcss.com/) for styling.




## Routing
This project uses [TanStack Router](https://tanstack.com/router). The initial setup is a file based router. Which means that the routes are managed as files in `src/routes`.

### Adding A Route

To add a new route to your application just add another a new file in the `./src/routes` directory.

TanStack will automatically generate the content of the route file for you.

Now that you have two routes you can use a `Link` component to navigate between them.

### Adding Links

To use SPA (Single Page Application) navigation you will need to import the `Link` component from `@tanstack/react-router`.

```tsx
import { Link } from "@tanstack/react-router";
```

Then anywhere in your JSX you can use it like so:

```tsx
<Link to="/about">About</Link>
```

This will create a link that will navigate to the `/about` route.

More information on the `Link` component can be found in the [Link documentation](https://tanstack.com/router/v1/docs/framework/react/api/router/linkComponent).

### Using A Layout

In the File Based Routing setup the layout is located in `src/routes/__root.tsx`. Anything you add to the root route will appear in all the routes. The route content will appear in the JSX where you use the `<Outlet />` component.

Here is an example layout that includes a header:

```tsx
import { Outlet, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

import { Link } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => (
    <>
      <header>
        <nav>
          <Link to="/">Home</Link>
          <Link to="/about">About</Link>
        </nav>
      </header>
      <Outlet />
      <TanStackRouterDevtools />
    </>
  ),
})
```

The `<TanStackRouterDevtools />` component is not required so you can remove it if you don't want it in your layout.

More information on layouts can be found in the [Layouts documentation](https://tanstack.com/router/latest/docs/framework/react/guide/routing-concepts#layouts).


## Data Fetching

There are multiple ways to fetch data in your application. You can use TanStack Query to fetch data from a server. But you can also use the `loader` functionality built into TanStack Router to load the data for a route before it's rendered.

For example:

```tsx
const peopleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/people",
  loader: async () => {
    const response = await fetch("https://swapi.dev/api/people");
    return response.json() as Promise<{
      results: {
        name: string;
      }[];
    }>;
  },
  component: () => {
    const data = peopleRoute.useLoaderData();
    return (
      <ul>
        {data.results.map((person) => (
          <li key={person.name}>{person.name}</li>
        ))}
      </ul>
    );
  },
});
```

Loaders simplify your data fetching logic dramatically. Check out more information in the [Loader documentation](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading#loader-parameters).

### React-Query

React-Query is an excellent addition or alternative to route loading and integrating it into you application is a breeze.

First add your dependencies:

```bash
npm install @tanstack/react-query @tanstack/react-query-devtools
```

Next we'll need to create a query client and provider. We recommend putting those in `main.tsx`.

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ...

const queryClient = new QueryClient();

// ...

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);

  root.render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
```

You can also add TanStack Query Devtools to the root route (optional).

```tsx
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

const rootRoute = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <ReactQueryDevtools buttonPosition="top-right" />
      <TanStackRouterDevtools />
    </>
  ),
});
```

Now you can use `useQuery` to fetch your data.

```tsx
import { useQuery } from "@tanstack/react-query";

import "./App.css";

function App() {
  const { data } = useQuery({
    queryKey: ["people"],
    queryFn: () =>
      fetch("https://swapi.dev/api/people")
        .then((res) => res.json())
        .then((data) => data.results as { name: string }[]),
    initialData: [],
  });

  return (
    <div>
      <ul>
        {data.map((person) => (
          <li key={person.name}>{person.name}</li>
        ))}
      </ul>
    </div>
  );
}

export default App;
```

You can find out everything you need to know on how to use React-Query in the [React-Query documentation](https://tanstack.com/query/latest/docs/framework/react/overview).

## State Management

Another common requirement for React applications is state management. There are many options for state management in React. TanStack Store provides a great starting point for your project.

First you need to add TanStack Store as a dependency:

```bash
npm install @tanstack/store
```

Now let's create a simple counter in the `src/App.tsx` file as a demonstration.

```tsx
import { useStore } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import "./App.css";

const countStore = new Store(0);

function App() {
  const count = useStore(countStore);
  return (
    <div>
      <button onClick={() => countStore.setState((n) => n + 1)}>
        Increment - {count}
      </button>
    </div>
  );
}

export default App;
```

One of the many nice features of TanStack Store is the ability to derive state from other state. That derived state will update when the base state updates.

Let's check this out by doubling the count using derived state.

```tsx
import { useStore } from "@tanstack/react-store";
import { Store, Derived } from "@tanstack/store";
import "./App.css";

const countStore = new Store(0);

const doubledStore = new Derived({
  fn: () => countStore.state * 2,
  deps: [countStore],
});
doubledStore.mount();

function App() {
  const count = useStore(countStore);
  const doubledCount = useStore(doubledStore);

  return (
    <div>
      <button onClick={() => countStore.setState((n) => n + 1)}>
        Increment - {count}
      </button>
      <div>Doubled - {doubledCount}</div>
    </div>
  );
}

export default App;
```

We use the `Derived` class to create a new store that is derived from another store. The `Derived` class has a `mount` method that will start the derived store updating.

Once we've created the derived store we can use it in the `App` component just like we would any other store using the `useStore` hook.

You can find out everything you need to know on how to use TanStack Store in the [TanStack Store documentation](https://tanstack.com/store/latest).

# Demo files

Files prefixed with `demo` can be safely deleted. They are there to provide a starting point for you to play around with the features you've installed.

# Learn More

You can learn more about all of the offerings from TanStack in the [TanStack documentation](https://tanstack.com).

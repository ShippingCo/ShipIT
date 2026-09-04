/*
  Entry point for the ShippingCo API.

  Deliberately empty. The folder structure around it is agreed (see README.md) but no
  backend has been designed yet — that starts once the Postgres schema is settled. When
  it does, this file does one job and no other: read the environment, build the server,
  listen, and shut down cleanly on a signal. Everything else belongs in server.ts and
  the modules beside it.
*/

export {};

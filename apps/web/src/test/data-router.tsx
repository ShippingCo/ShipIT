import React, {useEffect,useState} from 'react';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';

/** Same data-router/blocker contract as the production hash router. */
export function DataRouter({children,...options}:{children:React.ReactNode}&NonNullable<Parameters<typeof createMemoryRouter>[1]>) {
 const [router]=useState(()=>createMemoryRouter([{path:'*',element:children}],options));
 useEffect(()=>()=>router.dispose(),[router]);
 return <RouterProvider router={router}/>;
}

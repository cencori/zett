import ToastProvider from "../providers/ToastProvider";
import DialogProvider from "../providers/DialogProvider";
import ModelProvider from "../providers/ModelProvider";
import { KeymapProvider } from "@opentui/keymap/react";
import { Outlet } from "react-router";
import { keymap } from "../index";

const index = () => {
  return (
    <KeymapProvider keymap={keymap}>
      <ModelProvider>
        <ToastProvider>
          <DialogProvider>
            <Outlet />
          </DialogProvider>
        </ToastProvider>
      </ModelProvider>
    </KeymapProvider>
  );
};

export default index;

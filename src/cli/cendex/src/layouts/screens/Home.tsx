import { useNavigate } from "react-router";
import { theme } from "../../../theme";
import Header from "../../components/Header";
import InputBar from "../../components/InputBar";
import {
  useModels,
  type ModelContextValue,
} from "../../providers/ModelProvider";
import {
  useToast,
  type ToastContextValue,
} from "../../providers/ToastProvider";
import { useEffect } from "react";

const Home = () => {
  const navig = useNavigate();
  const { activeModel, setSessionMessages } = useModels() as ModelContextValue;
  const { show } = useToast() as ToastContextValue;

  const action = (data?: any) => {
    if (!activeModel) {
      show("Please select a model", "error");
      return;
    }
    navig("/new-session", { replace: true, state: data });
  };

  useEffect(() => {
    setSessionMessages([]);
  }, []);

  return (
    <box
      alignItems="flex-start"
      justifyContent="space-between"
      flexGrow={1}
      gap={1}
      backgroundColor={theme.backgroundColor}
    >
      <Header />
      <box paddingY={2} width={"100%"}>
        <InputBar action={action} />
      </box>
    </box>
  );
};

export default Home;

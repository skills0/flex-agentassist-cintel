import React from "react";
import * as Flex from "@twilio/flex-ui";
import { FlexPlugin } from "@twilio/flex-plugin";
import CIntelPanel from "./components/CIntelPanel";
import { withTaskContext } from "@twilio/flex-ui";
import { CustomizationProvider } from "@twilio-paste/core/customization";

const PLUGIN_NAME = "CintelRttPlugin";

export default class CintelRttPlugin extends FlexPlugin {
  constructor() {
    super(PLUGIN_NAME);
  }

  /**
   * This code is run when your plugin is being started
   * Use this to modify any UI components or attach to the actions framework
   *
   * @param flex { typeof Flex }
   */
  async init(flex: typeof Flex, manager: Flex.Manager): Promise<void> {
    const options: Flex.ContentFragmentProps = { sortOrder: -1 };
    flex.CRMContainer.Content.remove('placeholder');

    flex.setProviders({
      PasteThemeProvider: CustomizationProvider,
    });

    const PanelWithTask = withTaskContext(CIntelPanel);
    flex.CRMContainer.Content.add(
      <PanelWithTask key='CintelRttPlugin-component' manager={manager} />,
      options,
    );
  }
}
